import { crearGuardado, sedeDeURL, validarRegistro, mensaje, escapar as h, SEDES } from './util.js';
import { crearApi, cadaTanto } from './api.js';

const api = crearApi(window.IAL_CONFIG);
const guardado = crearGuardado();
const sede = sedeDeURL(location.search);
const LLAVE = `ial_token_${sede}`;
const $app = document.getElementById('app');
const $tabs = document.getElementById('pestanas');
const $red = document.getElementById('aviso-red');
const LETRAS = 'ABCDEFGH';

let token = guardado.get(LLAVE);
let st = null;              // último estado del servidor
let tab = 'ahora';
let ocupado = false;
let ultimaFirma = '';
let sondeo = null;

// ---------- Entrada ----------
function vistaEntrada(modo = 'registro', error = '') {
  $tabs.hidden = true;
  const registro = modo === 'registro';
  $app.innerHTML = `
    <header class="cabecera"><div class="marca"><b>IA para líderes</b><small>${h(SEDES[sede])} · reto en vivo</small></div></header>
    <h1>${registro ? 'Entra al reto' : 'Vuelve a entrar'}</h1>
    <p class="sub">${registro
      ? 'Escribe tus datos y elige un PIN de 4 números. Con tu correo y ese PIN vuelves a entrar el Día 2 o desde otro celular.'
      : 'Escribe el correo y el PIN que usaste la primera vez.'}</p>
    <form id="f" novalidate>
      ${registro ? `
      <label class="campo"><span>Nombre</span><input name="nombre" autocomplete="given-name" required></label>
      <label class="campo"><span>Apellido</span><input name="apellido" autocomplete="family-name" required></label>` : ''}
      <label class="campo"><span>Correo @cecomsa.com</span><input name="correo" type="email" autocomplete="email" autocapitalize="off" inputmode="email" required></label>
      <label class="campo"><span>PIN (4 números)</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></label>
      <p class="error" id="err">${h(error)}</p>
      <button class="btn" type="submit">${registro ? 'Entrar' : 'Entrar con mi PIN'}</button>
    </form>
    <button class="enlace" id="cambiar">${registro ? 'Ya tengo cuenta' : 'Es mi primera vez'}</button>`;
  document.getElementById('cambiar').onclick = () => vistaEntrada(registro ? 'entrar' : 'registro');
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    if (ocupado) return;
    const d = Object.fromEntries(new FormData(ev.target));
    const $err = document.getElementById('err');
    const local = registro ? validarRegistro(d) : (/^[0-9]{4}$/.test(d.pin || '') ? null : 'pin_invalido');
    if (local) { $err.textContent = mensaje(local); return; }
    ocupado = true;
    const btn = ev.target.querySelector('button'); btn.disabled = true;
    const r = registro
      ? await api.registrar(sede, d.nombre, d.apellido, d.correo, d.pin)
      : await api.entrar(sede, d.correo, d.pin);
    ocupado = false; btn.disabled = false;
    if (r.error) {
      if (r.error === 'ya_registrado') return vistaEntrada('entrar', mensaje(r.error));
      $err.textContent = mensaje(r.error);
      return;
    }
    token = r.data.token;
    guardado.set(LLAVE, token);
    arrancar();
  };
}

// ---------- Juego ----------
function cabecera() {
  const y = st.yo;
  return `<header class="cabecera">
    <div class="marca"><b>IA para líderes</b><small>${h(SEDES[sede])}${y.equipo ? ' · ' + h(y.equipo.nombre) : ''}</small></div>
    <div class="pildora">${h(y.nombre)} · <span class="pts">${y.puntos} pts</span></div>
  </header>`;
}

function vistaAhora() {
  const a = st.actividad;
  if (!a) {
    return `<div class="espera"><div class="grande">☕</div><h1>Espera la siguiente actividad</h1>
      <p class="sub">La facilitadora la abrirá en la pantalla. Mientras, mira el marcador.</p></div>`;
  }
  if (a.tipo === 'equipos') return vistaEquipos();
  const r = a.mi_respuesta;
  let html = `<p class="sub" style="margin:0 0 4px">${a.tipo === 'quiz' ? 'Pregunta' : a.tipo === 'nube' ? 'Nube de palabras' : 'Encuesta'}</p><h1>${h(a.pregunta)}</h1>`;

  if (a.tipo === 'nube') {
    if (r) return html + `<div class="tarjeta"><h3>Listo: «${h(r.texto)}»</h3><p>+${r.puntos} pts. Mira la nube en la pantalla.</p></div>`;
    if (a.estado !== 'abierta') return html + `<div class="tarjeta"><p>Esta actividad ya cerró.</p></div>`;
    return html + `<form id="fnube"><label class="campo"><span>Hasta 4 palabras</span><input name="t" maxlength="40" autocomplete="off"></label>
      <p class="error" id="err"></p><button class="btn rosa">Enviar</button></form>`;
  }

  const abierta = a.estado === 'abierta' && !r;
  html += `<div class="opciones">` + a.opciones.map((o, i) => {
    let cls = '';
    if (r && a.tipo === 'quiz') cls = i === r.correcta_idx ? 'bien' : (i === r.opcion ? 'mal' : '');
    else if (r && i === r.opcion) cls = 'elegida';
    return `<button class="opcion ${cls}" data-op="${i}" ${abierta ? '' : 'disabled'}><span class="letra">${LETRAS[i]}</span><span>${h(o)}</span></button>`;
  }).join('') + `</div><p class="error" id="err"></p>`;

  if (r && a.tipo === 'quiz') {
    html += r.correcta
      ? `<div class="tarjeta bien"><h3>¡Correcto! +${r.puntos} pts</h3><p>${h(r.explicacion)}</p></div>`
      : `<div class="tarjeta mal"><h3>Esta vez no</h3><p>${h(r.explicacion)}</p></div>`;
  } else if (r) {
    html += `<div class="tarjeta"><h3>¡Gracias! +${r.puntos} pts</h3><p>Mira los resultados en la pantalla.</p></div>`;
  } else if (!abierta) {
    html += `<div class="tarjeta"><p>Esta actividad ya cerró.</p></div>`;
  }
  return html;
}

function vistaEquipos() {
  const eq = st.equipos;
  const mio = st.yo.equipo;
  const abierto = eq && eq.estado === 'abierta';
  let html = `<h1>Armen sus equipos</h1><p class="sub">De 2 a 4 personas. Mezclen niveles: alguien que ya usa IA a diario con alguien que está empezando.</p>`;
  if (mio) {
    html += `<div class="tarjeta negra"><h3>Tu equipo: <span class="rosa">${h(mio.nombre)}</span></h3>
      <p>${mio.miembros.map(h).join(' · ')}</p>
      ${mio.miembros.length < 2 ? '<p style="margin-top:8px">Les falta al menos una persona más.</p>' : ''}</div>`;
    if (abierto) html += `<button class="btn secundario" id="salir" style="margin-top:12px">Salir del equipo</button>`;
  } else if (abierto) {
    html += `<form class="fila-crear" id="fcrear"><input name="n" maxlength="30" placeholder="Nombre de un equipo nuevo" autocomplete="off"><button>Crear</button></form>`;
  }
  html += `<p class="error" id="err"></p>`;
  if (eq) {
    html += `<h2>Equipos</h2>` + (eq.lista.length ? eq.lista.map(e => `
      <div class="equipo ${mio && mio.id === e.id ? 'mio' : ''}">
        <div><b>${h(e.nombre)}</b><small>${e.miembros.map(h).join(' · ') || 'sin miembros'} · ${e.miembros.length}/${e.cupo_max}</small></div>
        ${!mio && abierto ? `<button class="btn-chico ${e.lleno ? 'lleno' : ''}" data-unir="${e.id}" ${e.lleno ? 'disabled' : ''}>${e.lleno ? 'Completo' : 'Unirme'}</button>` : ''}
      </div>`).join('') : '<p class="sub">Todavía no hay equipos. ¡Crea el primero!</p>');
    if (eq.sin_equipo.length) html += `<h2>Sin equipo todavía</h2><div class="chips">${eq.sin_equipo.map(n => `<span class="chip">${h(n)}</span>`).join('')}</div>`;
    if (!abierto) html += `<div class="tarjeta" style="margin-top:16px"><p>El armado de equipos está cerrado. Si necesitas cambiarte, pídeselo a la facilitadora.</p></div>`;
  }
  return html;
}

function vistaMiEquipo() {
  const mio = st.yo.equipo;
  if (!mio) return `<div class="espera"><div class="grande">👥</div><h1>Todavía no tienes equipo</h1><p class="sub">Se arman en vivo cuando la facilitadora lo indique.</p></div>`;
  return `<h1>${h(mio.nombre)}</h1><div class="chips">${mio.miembros.map(n => `<span class="chip">${h(n)}</span>`).join('')}</div>
    <div class="tarjeta" style="margin-top:18px"><h3>Próximamente</h3><p>Aquí subirán las fotos de sus avances y el registro de las dos semanas.</p></div>`;
}

function filasRanking(lista, marcarTop) {
  if (!lista.length) return '<p class="sub">Aún no hay puntos.</p>';
  return `<ol class="ranking">${lista.map(x => `<li class="${x.yo ? 'yo' : ''} ${x.puesto <= marcarTop ? 'top' : ''}">
    <span class="pos">${x.puesto}</span><span class="nom">${h(x.nombre)}</span><span class="pt">${x.puntos}</span></li>`).join('')}</ol>`;
}

function vistaMarcador() {
  return `<h1>Marcador</h1><h2>Equipos</h2>${filasRanking(st.ranking.equipos, 2)}<h2>Personas</h2>${filasRanking(st.ranking.personas, 3)}`;
}

function render(forzar = false) {
  const vista = tab === 'ahora' ? vistaAhora() : tab === 'equipo' ? vistaMiEquipo() : vistaMarcador();
  const firma = tab + cabecera() + vista;
  if (!forzar && firma === ultimaFirma) return;
  // No pisar lo que la persona está escribiendo.
  const activo = document.activeElement;
  if (!forzar && activo && activo.tagName === 'INPUT' && $app.contains(activo)) return;
  ultimaFirma = firma;
  $app.innerHTML = cabecera() + vista;
  $tabs.hidden = false;
  enlazar();
}

function mostrarError(codigo) {
  const $e = document.getElementById('err');
  if ($e) $e.textContent = mensaje(codigo);
}

async function accion(fn) {
  if (ocupado) return;
  ocupado = true;
  $app.querySelectorAll('button').forEach(b => (b.disabled = true));
  const r = await fn();
  ocupado = false;
  if (r.error === 'sesion_invalida') return salir();
  await actualizar();
  render(true);
  if (r.error) mostrarError(r.error);
}

function enlazar() {
  $app.querySelectorAll('[data-op]').forEach(b => (b.onclick = () =>
    accion(() => api.responder(token, st.actividad.id, Number(b.dataset.op)))));
  const fn = document.getElementById('fnube');
  if (fn) fn.onsubmit = (ev) => { ev.preventDefault(); const t = ev.target.t.value; accion(() => api.responder(token, st.actividad.id, null, t)); };
  const fc = document.getElementById('fcrear');
  if (fc) fc.onsubmit = (ev) => { ev.preventDefault(); const n = ev.target.n.value; accion(() => api.crearEquipo(token, n)); };
  $app.querySelectorAll('[data-unir]').forEach(b => (b.onclick = () => accion(() => api.unirseEquipo(token, b.dataset.unir))));
  const s = document.getElementById('salir');
  if (s) s.onclick = () => accion(() => api.salirEquipo(token));
}

async function actualizar() {
  const r = await api.estado(token);
  if (r.error === 'red') { $red.hidden = false; return; }
  $red.hidden = true;
  if (r.error === 'sesion_invalida') return salir();
  if (r.error) return;
  st = r.data;
}

function salir() {
  guardado.del(LLAVE);
  token = null; st = null;
  if (sondeo) sondeo.parar();
  vistaEntrada('entrar', mensaje('sesion_invalida'));
}

$tabs.onclick = (ev) => {
  const b = ev.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  $tabs.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  if (st) render(true);
  window.scrollTo(0, 0);
};

async function arrancar() {
  sondeo = cadaTanto(async () => { await actualizar(); if (st && token) render(); }, 3000);
}

if (!sede) {
  $app.innerHTML = `<div class="espera"><div class="grande">📷</div><h1>${h(mensaje('sede_invalida'))}</h1></div>`;
} else if (token) {
  arrancar();
} else {
  vistaEntrada();
}
