(function(root) {
  'use strict';
  const significados = [null,
    'el agua', 'el zapato', 'el niño', 'la cama', 'el hombre', 'la mujer', 'el revólver', 'la culebra', 'el muerto', 'el cañón',
    'el árbol', 'el soldado', 'el gato', 'el borracho', 'la quinceañera', 'el anillo', 'la desgracia', 'la sangre', 'el pescado', 'la fiesta',
    'el río', 'los patos', 'el cocinero', 'el caballo', 'el fantasma', 'la misa', 'el peine', 'el loco', 'el espejo', 'las flores',
    'la luz', 'el dinero', 'el Cristo', 'la cabeza', 'el pajarito', 'la mantequilla', 'los dientes', 'la piedra', 'la lluvia', 'la danza',
    'el cuchillo', 'las prendas', 'el maco', 'la cárcel', 'la pistola', 'los tomates', 'San Cono', 'el muerto habla', 'la carne', 'el pan',
    'el serrucho', 'la bebida', 'el barco', 'la vaca', 'la música', 'la caída', 'el jorobado', 'el abogado', 'la planta', 'la escuela',
    'la escopeta', 'la inundación', 'la madre e hija', 'el llanto', 'la boda', 'las dos mujeres', 'la mordida', 'los sobrinos', 'los vicios', 'el limosnero',
    'el excremento', 'el jarrón', 'el hospital', 'los negros', 'el payaso', 'las llamas', 'las muletas', 'la prostituta', 'el ladrón', 'la pelota',
    'las flores', 'la pelea', 'el mal tiempo', 'la iglesia', 'la linterna', 'el humo', 'los piojos', 'el Papa', 'la rata', 'el miedo'
  ];
  const unidades = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
  function numeroATexto(n) {
    if (!Number.isInteger(n) || n < 1 || n > 90) return null;
    if (n < 30) return unidades[n];
    const decenas = ['','','','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
    return decenas[Math.floor(n / 10)] + (n % 10 ? ' y ' + unidades[n % 10] : '');
  }
  function frase(n) {
    const texto = numeroATexto(n);
    return texto ? texto[0].toUpperCase() + texto.slice(1) + ', ' + significados[n] + '.' : null;
  }
  const mensajes = new WeakMap();
  function locucion(texto, {gender, voice, volume = 1}, env) {
    const utter = new env.SpeechSynthesisUtterance(texto);
    if (voice?.lang?.toLowerCase().startsWith('es')) utter.voice = voice;
    utter.lang = utter.voice?.lang || 'es-ES';
    utter.pitch = gender === 'femenina' ? 1.15 : 0.85;
    utter.rate = 0.95;
    utter.volume = volume;
    return utter;
  }
  function cancelar(env = root) {
    mensajes.delete(env);
    env.speechSynthesis?.cancel();
  }
  function cantar(n, opciones, env = root) {
    const texto = frase(n);
    if (!env.speechSynthesis) return;
    const activo = mensajes.get(env);
    if (activo) { activo.numeroPendiente = {n, opciones}; return; }
    cancelar(env);
    if (!texto || opciones.gender === 'ninguna') return;
    env.speechSynthesis.speak(locucion(texto, opciones, env));
  }
  function leerMensaje(texto, opciones, env = root) {
    if (!env.speechSynthesis || !env.SpeechSynthesisUtterance || !texto?.trim() || opciones.gender === 'ninguna') return;
    const pendiente = mensajes.get(env)?.numeroPendiente;
    cancelar(env);
    const activo = {numeroPendiente: pendiente};
    mensajes.set(env, activo);
    const terminar = error => {
      if (mensajes.get(env) !== activo) return;
      mensajes.delete(env);
      if (error) opciones.onError?.();
      if (activo.numeroPendiente) cantar(activo.numeroPendiente.n, activo.numeroPendiente.opciones, env);
    };
    const utter = locucion(texto, opciones, env);
    utter.onend = () => terminar(false);
    utter.onerror = () => terminar(true);
    try { env.speechSynthesis.speak(utter); } catch { terminar(true); }
  }
  function silenciarMensajes(env = root) {
    const activo = mensajes.get(env);
    if (!activo) return;
    cancelar(env);
    if (activo.numeroPendiente) cantar(activo.numeroPendiente.n, activo.numeroPendiente.opciones, env);
  }
  const api = {numeroATexto, frase, cantar, leerMensaje, cancelar, silenciarMensajes, mensajeActivo: (env = root) => mensajes.has(env)};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BingoVoz = api;
})(typeof window === 'undefined' ? globalThis : window);
