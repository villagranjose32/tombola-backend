(function(root) {
  'use strict';
  const colores = ['#e6af18','#2874d0','#dc4743','#8556bd','#eb8325','#25946e','#b94770','#394454'];
  class BolilleroBolas {
    constructor(cage, env = root) {
      this.cage = cage; this.env = env; this.bolas = []; this.frame = null;
    }
    actualizar(estado = {}) {
      this.detener();
      const rango = estado.rangoMax || 90;
      const extraidas = new Set(estado.numerosExtraidos || estado.bolillas || []);
      const numeros = Array.from({length:rango}, (_,i) => i + 1).filter(n => estado.modo === 'REPETICION' || !extraidas.has(n));
      this.cage.querySelectorAll('.mini-ball').forEach(b => b.remove());
      const lado = this.cage.clientWidth || 210;
      this.centro = lado / 2;
      this.radio = Math.min(11, Math.max(2.5, Math.floor(78 / Math.sqrt(rango))));
      this.limite = this.centro - this.radio - 4;
      const posiciones = [];
      // Filas compactas apoyadas en el fondo circular de la jaula.
      const paso = this.radio * 2 + .5;
      for (let fila = 0, y = this.centro + this.limite; y >= this.centro - this.limite && posiciones.length < numeros.length; fila++, y -= this.radio * 1.8 + .5) {
        const ancho = Math.sqrt(Math.max(0, this.limite ** 2 - (y - this.centro) ** 2));
        const cantidad = Math.floor(ancho * 2 / paso) + 1;
        for (let i=0;i<cantidad;i++) posiciones.push({x:this.centro + (i - (cantidad-1)/2) * paso,y});
      }
      this.bolas = numeros.map((numero, i) => {
        const el = this.cage.ownerDocument.createElement('span');
        el.className = 'mini-ball'; el.dataset.numero = numero;
        el.textContent = String(numero).padStart(String(rango).length, '0');
        el.style.setProperty('--ball-color', colores[(numero-1)%colores.length]);
        el.style.width = el.style.height = this.radio * 2 + 'px';
        el.style.fontSize = Math.max(4, this.radio * .9) + 'px';
        this.cage.append(el);
        return {el,numero,...(posiciones[i] || {x:this.centro,y:this.centro}),vx:0,vy:0};
      });
      this.cage.dataset.restantes = numeros.length;
      this.cage.setAttribute('aria-label', `Bolillero con ${numeros.length} bolillas${estado.modo === 'REPETICION' ? ', con reposición' : ' disponibles'}`);
      this.pintar();
      return numeros.length;
    }
    pintar() {
      for (const b of this.bolas) b.el.style.transform = `translate(${b.x-this.radio}px,${b.y-this.radio}px)`;
    }
    mezclar(numeroSalida, duracion = 650) {
      this.detener();
      const inicio = this.env.performance.now(); let anterior = inicio;
      for (const b of this.bolas) { b.vx = (Math.random()-.5)*340; b.vy = -100-Math.random()*220; b.salidaInicio = null; }
      const mover = ahora => {
        const dt = Math.min(.025, Math.max(0, (ahora-anterior)/1000)); anterior = ahora;
        const salida = ahora-inicio > duracion - 210 ? numeroSalida : null;
        for (const b of this.bolas) {
          if (b.numero === salida) {
            b.salidaInicio ||= {x:b.x,y:b.y};
            const avance = Math.min(1,(ahora-inicio-(duracion-210))/210);
            b.x = b.salidaInicio.x+(this.centro-b.salidaInicio.x)*avance;
            b.y = b.salidaInicio.y+(this.centro*2+this.radio*2-b.salidaInicio.y)*avance;
            b.el.style.zIndex = '2'; continue;
          }
          const dx = b.x-this.centro, dy=b.y-this.centro;
          // La jaula arrastra las bolas al girar; la gravedad las hace caer.
          b.vx += (-dy/this.limite*1300)*dt;
          b.vy += (dx/this.limite*1300+600)*dt;
          const velocidad = Math.hypot(b.vx,b.vy);
          if (velocidad>600) { b.vx*=600/velocidad; b.vy*=600/velocidad; }
          b.x+=b.vx*dt; b.y+=b.vy*dt;
          const distancia=Math.hypot(b.x-this.centro,b.y-this.centro);
          if (distancia>this.limite) {
            const nx=(b.x-this.centro)/distancia,ny=(b.y-this.centro)/distancia;
            b.x=this.centro+nx*this.limite;b.y=this.centro+ny*this.limite;
            const normal=b.vx*nx+b.vy*ny;
            if(normal>0){b.vx-=1.8*normal*nx;b.vy-=1.8*normal*ny;}
          }
        }
        // Agrupar por proximidad evita comparar todas las bolas entre sí.
        const celdas=new Map(), diametro=this.radio*2;
        for(const b of this.bolas) {
          if(b.numero===salida)continue;
          const gx=Math.floor(b.x/diametro),gy=Math.floor(b.y/diametro);
          for(let x=gx-1;x<=gx+1;x++)for(let y=gy-1;y<=gy+1;y++)for(const otra of celdas.get(x+','+y)||[]) {
            const dx=b.x-otra.x,dy=b.y-otra.y,d=Math.hypot(dx,dy);
            if(d===0||d>=diametro)continue;
            const nx=dx/d,ny=dy/d,separacion=(diametro-d)/2;
            b.x+=nx*separacion;b.y+=ny*separacion;otra.x-=nx*separacion;otra.y-=ny*separacion;
            const choque=(b.vx-otra.vx)*nx+(b.vy-otra.vy)*ny;
            if(choque<0){b.vx-=choque*nx;b.vy-=choque*ny;otra.vx+=choque*nx;otra.vy+=choque*ny;}
          }
          const clave=gx+','+gy;if(!celdas.has(clave))celdas.set(clave,[]);celdas.get(clave).push(b);
        }
        this.pintar();
        this.frame=this.env.requestAnimationFrame(mover);
      };
      this.frame=this.env.requestAnimationFrame(mover);
    }
    detener() {
      if(this.frame !== null)this.env.cancelAnimationFrame(this.frame);
      this.frame=null;
    }
  }
  if(typeof module !== 'undefined' && module.exports)module.exports=BolilleroBolas;
  else root.BolilleroBolas=BolilleroBolas;
})(typeof window !== 'undefined' ? window : globalThis);
