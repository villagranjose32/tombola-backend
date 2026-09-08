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
  function cantar(n, {gender, voice, volume = 1}, env = root) {
    const texto = frase(n);
    if (!env.speechSynthesis) return;
    env.speechSynthesis.cancel();
    if (!texto || gender === 'ninguna') return;
    const utter = new env.SpeechSynthesisUtterance(texto);
    if (voice?.lang?.toLowerCase().startsWith('es')) utter.voice = voice;
    utter.lang = utter.voice?.lang || 'es-ES';
    utter.pitch = gender === 'femenina' ? 1.15 : 0.85;
    utter.rate = 0.95;
    utter.volume = volume;
    env.speechSynthesis.speak(utter);
  }
  const api = {numeroATexto, frase, cantar};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BingoVoz = api;
})(typeof window === 'undefined' ? globalThis : window);
