// Cliente de las funciones RPC. Cada método devuelve { data, error } con error = código o null.

const espera = (ms) => new Promise(r => setTimeout(r, ms));

export function crearApi({ url, anonKey, timeoutMs = 9000 }, fetcher = globalThis.fetch?.bind(globalThis)) {
  async function rpc(nombre, args, ms = timeoutMs) {
    // Con mal wifi una llamada puede quedar colgada un minuto: se corta y se trata como «sin conexión».
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), ms);
    let r, cuerpo = null;
    try {
      r = await fetcher(`${url}/rest/v1/rpc/${nombre}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: corte.signal,
      });
      try { cuerpo = await r.json(); } catch {}
    } catch {
      return { data: null, error: 'red' };
    } finally {
      clearTimeout(reloj);
    }
    if (!r.ok) return { data: null, error: (cuerpo && cuerpo.message) || (r.status >= 500 ? 'red' : 'error') };
    // Ninguna función devuelve vacío: si llega vacío, fue un corte a medio camino.
    if (cuerpo === null) return { data: null, error: 'red' };
    if (typeof cuerpo === 'object' && typeof cuerpo.error === 'string') return { data: null, error: cuerpo.error };
    return { data: cuerpo, error: null };
  }

  async function conReintento(nombre, args, intentos = 3) {
    let res;
    for (let i = 0; i < intentos; i++) {
      res = await rpc(nombre, args);
      if (res.error !== 'red') return res;
      await espera(1000);
    }
    return res;
  }

  return {
    rpc,
    registrar: (sede, nombre, apellido, correo, pin) => rpc('registrar', { p_sede: sede, p_nombre: nombre, p_apellido: apellido, p_correo: correo, p_pin: pin }),
    entrar: (sede, correo, pin) => rpc('entrar', { p_sede: sede, p_correo: correo, p_pin: pin }),
    estado: (token) => rpc('estado', { p_token: token }),
    // Idempotente en el servidor: se puede reintentar sin riesgo de puntos dobles.
    responder: (token, actividad, opcion = null, texto = null) => conReintento('responder', { p_token: token, p_actividad: actividad, p_opcion: opcion, p_texto: texto }),
    crearEquipo: (token, nombre) => rpc('crear_equipo', { p_token: token, p_nombre: nombre }),
    unirseEquipo: (token, equipo) => rpc('unirse_equipo', { p_token: token, p_equipo: equipo }),
    salirEquipo: (token) => rpc('salir_equipo', { p_token: token }),
    pantalla: (sede) => rpc('pantalla', { p_sede: sede }),
    // Una foto puede tardar más en subir con mal wifi: 30 s. Reintentar es seguro (reemplaza la entrega pendiente).
    entregar: (token, actividad, texto = null, texto2 = null, foto = null) => foto
      ? rpc('entregar', { p_token: token, p_actividad: actividad, p_texto: texto, p_texto2: texto2, p_foto: foto }, 30000)
      : conReintento('entregar', { p_token: token, p_actividad: actividad, p_texto: texto, p_texto2: texto2, p_foto: null }, 2),
    f: {
      estado: (token, sede) => rpc('f_estado', { p_token: token, p_sede: sede }),
      actividad: (token, sede, actividad, estado) => rpc('f_actividad', { p_token: token, p_sede: sede, p_actividad: actividad, p_estado: estado }),
      equipos: (token, sede, estado) => rpc('f_equipos', { p_token: token, p_sede: sede, p_estado: estado }),
      mover: (token, persona, equipo) => rpc('f_mover', { p_token: token, p_persona: persona, p_equipo: equipo }),
      excepcion: (token, equipo, activa) => rpc('f_excepcion', { p_token: token, p_equipo: equipo, p_activa: activa }),
      crearEquipo: (token, sede, nombre) => rpc('f_crear_equipo', { p_token: token, p_sede: sede, p_nombre: nombre }),
      resetPin: (token, persona, pin) => rpc('f_reset_pin', { p_token: token, p_persona: persona, p_pin: pin }),
      registrar: (token, sede, nombre, apellido, correo, pin) => rpc('f_registrar', { p_token: token, p_sede: sede, p_nombre: nombre, p_apellido: apellido, p_correo: correo, p_pin: pin }),
      borrarPersona: (token, persona) => rpc('f_borrar_persona', { p_token: token, p_persona: persona }),
      entregas: (token, sede) => rpc('f_entregas', { p_token: token, p_sede: sede }),
      foto: (token, entrega) => rpc('f_foto', { p_token: token, p_entrega: entrega }, 30000),
      // actualizado = la versión de la entrega que la facilitadora vio.
      revisar: (token, entrega, estado, motivo, actualizado) => rpc('f_revisar', { p_token: token, p_entrega: entrega, p_estado: estado, p_motivo: motivo, p_actualizado: actualizado }),
    },
  };
}

// Consulta periódica que se pausa con la pestaña oculta.
export function cadaTanto(fn, ms) {
  let timer = null, corriendo = false;
  async function tick() {
    if (corriendo) return;
    corriendo = true;
    try { await fn(); } finally { corriendo = false; }
  }
  function arrancar() { if (!timer) { tick(); timer = setInterval(tick, ms); } }
  function parar() { clearInterval(timer); timer = null; }
  document.addEventListener('visibilitychange', () => (document.hidden ? parar() : arrancar()));
  arrancar();
  return { ahora: tick, parar };
}
