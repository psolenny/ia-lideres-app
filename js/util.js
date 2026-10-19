// Funciones puras compartidas por las tres páginas. Sin dependencias.

export const SEDES = { santiago: 'Santiago', sd: 'Santo Domingo', prueba: 'Prueba', demo: 'Demo' };

// Guarda en localStorage si se puede; si el navegador lo bloquea, en memoria.
export function crearGuardado(storage = globalThis.localStorage) {
  const memoria = new Map();
  return {
    get(k) {
      try { const v = storage.getItem(k); if (v !== null && v !== undefined) return v; } catch {}
      return memoria.has(k) ? memoria.get(k) : null;
    },
    set(k, v) {
      memoria.set(k, v);
      try { storage.setItem(k, v); } catch {}
    },
    del(k) {
      memoria.delete(k);
      try { storage.removeItem(k); } catch {}
    },
  };
}

export function sedeDeURL(search) {
  const s = new URLSearchParams(search || '').get('sede');
  return s && Object.prototype.hasOwnProperty.call(SEDES, s) ? s : null;
}

export function normalizarCorreo(c) {
  return String(c || '').trim().toLowerCase();
}

// Mismo criterio que la función registrar() del servidor.
export function validarRegistro({ nombre, apellido, correo, pin }) {
  if (!String(nombre || '').trim() || !String(apellido || '').trim()) return 'datos_incompletos';
  if (!/^[^@\s]+@cecomsa\.com$/.test(normalizarCorreo(correo))) return 'correo_invalido';
  if (!/^[0-9]{4}$/.test(String(pin || ''))) return 'pin_invalido';
  return null;
}

export const MENSAJES = {
  datos_incompletos: 'Escribe tu nombre y apellido',
  correo_invalido: 'Usa tu correo @cecomsa.com',
  pin_invalido: 'El PIN son 4 números',
  ya_registrado: 'Ese correo ya entró. Usa «Ya tengo cuenta»',
  credenciales: 'Correo o PIN incorrectos',
  bloqueado: 'Demasiados intentos. Espera 5 minutos o pide ayuda a la facilitadora',
  actividad_cerrada: 'Esta actividad ya cerró',
  opcion_invalida: 'Elige una de las opciones',
  texto_invalido: 'Escribe de 1 a 4 palabras',
  equipo_lleno: 'Ese equipo ya está completo',
  ya_tienes_equipo: 'Ya estás en un equipo',
  equipos_cerrado: 'El armado de equipos está cerrado',
  nombre_invalido: 'El nombre del equipo debe tener de 1 a 30 caracteres',
  nombre_repetido: 'Ya existe un equipo con ese nombre',
  equipo_no_existe: 'Ese equipo ya no existe',
  sesion_invalida: 'Tu sesión venció. Entra de nuevo',
  no_autorizado: 'Esta página es solo para la facilitadora',
  sede_invalida: 'Abre el enlace o el QR de tu sede',
  red: 'Sin conexión. Reintentando…',
};

export function mensaje(codigo) {
  return MENSAJES[codigo] || 'Algo falló. Intenta de nuevo';
}

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
