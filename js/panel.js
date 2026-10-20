import { crearGuardado, sedeDeURL, mensaje, escapar as h, SEDES } from './util.js';
import { crearApi, cadaTanto } from './api.js';

const api = crearApi(window.IAL_CONFIG);
const guardado = crearGuardado();
const LLAVE = 'ial_panel_token';
const NIVELES = ['Nunca', 'A veces', 'Semanal', 'Diario'];
const $p = document.getElementById('panel');
const $red = document.getElementById('aviso-red');

let sede = sedeDeURL(location.search) || guardado.get('ial_panel_sede') || 'santiago';
let token = guardado.get(LLAVE);
let tab = 'vivo';
let st = null;
let busqueda = '';
let entregas = [];
let filtroEntregas = 'pendiente';
const fotos = new Map();   // fotos ya descargadas, por «id:versión»
const cargandoFoto = new Set();
let ultimoHtml = '';
const EN_VIVO = ['encuesta', 'nube', 'quiz', 'equipos'];
let sondeo = null;

function toast(txt) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = txt;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ---------- Entrada ----------
function vistaEntrada(error = '') {
  $p.innerHTML = `<div style="max-width:420px;margin:40px auto">
    <h1>Panel de la facilitadora</h1>
    <p class="sub">Entra con el correo y el PIN con que te registraste en la app.</p>
    <form id="f">
      <label class="campo"><span>Sede</span><select name="sede" style="width:100%;padding:12px">${Object.entries(SEDES).map(([k, v]) => `<option value="${k}" ${k === sede ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="campo"><span>Correo</span><input name="correo" type="email" autocapitalize="off" required></label>
      <label class="campo"><span>Clave</span><input name="pin" type="password" autocomplete="current-password" required></label>
      <p class="error" id="err">${h(error)}</p>
      <button class="btn">Entrar</button>
    </form></div>`;
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    const r = await api.entrar(d.sede, d.correo, d.pin);
    if (r.error) return (document.getElementById('err').textContent = mensaje(r.error));
    if (!r.data.persona.es_facilitadora) return (document.getElementById('err').textContent = mensaje('no_autorizado'));
    token = r.data.token; guardado.set(LLAVE, token);
    cambiarSede(d.sede);
    arrancar();
  };
}

function cambiarSede(s) {
  sede = s; guardado.set('ial_panel_sede', s);
  history.replaceState(null, '', `?sede=${s}`);
}

// ---------- Vistas ----------
function barra() {
  const base = location.href.replace(/panel\.html.*$/, '');
  return `<div class="barra">
    <b>Panel · IA para líderes</b>
    <select id="sede">${Object.entries(SEDES).map(([k, v]) => `<option value="${k}" ${k === sede ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <a class="mini" href="${base}pantalla.html?sede=${sede}" target="_blank" rel="noopener">Abrir pantalla ↗</a>
    <div class="tabs" role="tablist">
      ${[['vivo', 'En vivo'], ['equipos', 'Equipos'], ['entregas', `Entregas${pendientes() ? ` (${pendientes()} por revisar)` : ''}`], ['personas', `Personas (${st ? st.personas.filter(x => !x.es_facilitadora).length : 0})`]]
        .map(([k, v]) => `<button data-tab="${k}" aria-selected="${tab === k}">${v}</button>`).join('')}
    </div>
  </div>`;
}

function vistaVivo() {
  return `<table class="tabla"><thead><tr><th>#</th><th>Lámina</th><th>Actividad</th><th>Estado</th><th>Resp.</th><th></th></tr></thead><tbody>
    ${st.actividades.map((a, i) => `<tr class="${a.estado !== 'cerrada' ? 'viva' : ''}">
      <td>${i + 1}</td>
      <td><small>${h(a.lamina || '')}</small></td>
      <td><b>${h(a.tipo)}</b> · ${h(a.pregunta)}</td>
      <td><span class="estado ${a.estado}">${a.estado}</span></td>
      <td>${a.tipo === 'equipos' ? '' : a.respuestas}${a.pendientes ? ` <span class="estado abierta">${a.pendientes} por revisar</span>` : ''}</td>
      <td class="acciones">
        <button class="primario" data-act="${a.id}" data-estado="abierta" ${a.estado === 'abierta' ? 'disabled' : ''}>Abrir</button>
        ${a.tipo === 'equipos' || !EN_VIVO.includes(a.tipo) ? '' : `<button data-act="${a.id}" data-estado="resultados" ${a.estado === 'resultados' ? 'disabled' : ''}>Resultados</button>`}
        <button data-act="${a.id}" data-estado="cerrada" ${a.estado === 'cerrada' ? 'disabled' : ''}>Cerrar</button>
      </td></tr>`).join('')}
  </tbody></table>`;
}

function vistaEquipos() {
  const personas = st.personas.filter(x => !x.es_facilitadora);
  const opcionesEq = (sel) => `<option value="">— sin equipo —</option>` +
    st.equipos.map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${h(e.nombre)}</option>`).join('');
  const fila = (x) => `<li><span>${h(x.nombre)} ${h(x.apellido)} ${x.nivel != null ? `<span class="nivel">${NIVELES[x.nivel]}</span>` : ''}</span>
    <select class="mini" data-mover="${x.id}">${opcionesEq(x.equipo_id)}</select></li>`;
  const sin = personas.filter(x => !x.equipo_id);
  return `<div class="acciones" style="margin-bottom:14px;align-items:center">
      <span>Armado: <span class="estado ${st.equipos_estado === 'abierta' ? 'abierta' : 'cerrada'}">${st.equipos_estado}</span></span>
      <button class="primario" data-equipos="abierta" ${st.equipos_estado === 'abierta' ? 'disabled' : ''}>Abrir armado</button>
      <button data-equipos="final" ${st.equipos_estado === 'final' ? 'disabled' : ''}>Cerrar armado</button>
      <form id="fcrear" class="acciones"><input class="mini" name="n" placeholder="Nombre de equipo" maxlength="30"><button>Crear equipo</button></form>
    </div>
    <div class="grilla-equipos">
      ${st.equipos.map(e => {
        const miembros = personas.filter(x => x.equipo_id === e.id);
        const cls = e.excepcion ? 'excepcion' : (miembros.length < 2 ? 'incompleto' : '');
        return `<div class="tarjeta-eq ${cls}"><h4><span>${h(e.nombre)}</span><small>${miembros.length}/${e.cupo_max}</small></h4>
          <ul>${miembros.map(fila).join('') || '<li><small>vacío</small></li>'}</ul>
          <button class="mini" data-excepcion="${e.id}" data-activa="${!e.excepcion}">${e.excepcion ? 'Quitar excepción' : 'Excepción (1 o 5)'}</button>
          ${miembros.length < 2 && !e.excepcion ? '<small> · incompleto</small>' : ''}</div>`;
      }).join('')}
      <div class="tarjeta-eq"><h4><span>Sin equipo</span><small>${sin.length}</small></h4><ul>${sin.map(fila).join('') || '<li><small>nadie</small></li>'}</ul></div>
    </div>`;
}

function pendientes() {
  return entregas.filter(e => e.estado === 'pendiente' && e.tipo !== 'checkin').length;
}

const TIPOS = { hito: 'Hito con foto', texto: 'Texto de equipo', checkin: 'Check-in' };

function vistaEntregas() {
  const lista = entregas.filter(e => filtroEntregas === 'todas' || (filtroEntregas === 'checkin' ? e.tipo === 'checkin' : (e.estado === filtroEntregas && e.tipo !== 'checkin')));
  const filtros = [['pendiente', 'Por revisar'], ['aprobado', 'Aprobadas'], ['rechazado', 'Rechazadas'], ['checkin', 'Check-ins'], ['todas', 'Todas']];
  return `<div class="tabs" style="margin-bottom:14px">${filtros.map(([k, v]) => `<button data-filtro="${k}" aria-selected="${filtroEntregas === k}">${v}</button>`).join('')}</div>
    ${lista.length ? lista.map(e => `<div class="entrega ${e.estado === 'pendiente' && e.tipo !== 'checkin' ? 'pendiente' : ''}">
      <div class="cab"><b>${h(e.equipo || e.subio)}</b><span><small>${h(TIPOS[e.tipo] || e.tipo)}</small> <span class="estado ${e.estado === 'aprobado' ? 'resultados' : e.estado === 'rechazado' ? 'abierta' : 'cerrada'}">${e.estado}</span></span></div>
      <p class="sub" style="margin:4px 0">${h(e.actividad)} · subió ${h(e.subio)}</p>
      ${e.tiene_foto ? (fotos.has(`${e.id}:${e.actualizado}`) ? `<img class="foto-rev" src="${h(fotos.get(`${e.id}:${e.actualizado}`))}" alt="Foto de ${h(e.equipo || e.subio)}">`
        : `<button class="mini" data-ver="${e.id}" data-version="${h(e.actualizado)}" ${cargandoFoto.has(e.id) ? 'disabled' : ''}>${cargandoFoto.has(e.id) ? 'Cargando…' : 'Ver foto'}</button>`) : ''}
      ${e.texto ? `<p class="cita">${h(e.texto)}</p>` : ''}${e.texto2 ? `<p class="cita">${h(e.texto2)}</p>` : ''}
      ${e.motivo ? `<p class="motivo">Motivo: ${h(e.motivo)}</p>` : ''}
      ${e.tipo === 'checkin' ? '' : `<div class="acciones" style="margin-top:8px">
        <button class="primario" data-revisar="${e.id}" data-version="${h(e.actualizado)}" data-estado="aprobado" ${e.estado === 'aprobado' || (e.tiene_foto && !fotos.has(`${e.id}:${e.actualizado}`)) ? 'disabled' : ''}>Aprobar</button>
        <button data-revisar="${e.id}" data-version="${h(e.actualizado)}" data-estado="rechazado" ${e.estado === 'rechazado' ? 'disabled' : ''}>Rechazar</button>
        ${e.tiene_foto && !fotos.has(`${e.id}:${e.actualizado}`) ? '<small>Mira la foto antes de aprobar</small>' : ''}</div>`}
    </div>`).join('') : '<p class="sub">No hay entregas en esta lista.</p>'}`;
}

function vistaPersonas() {
  const q = busqueda.toLowerCase();
  const lista = st.personas.filter(x => !q || `${x.nombre} ${x.apellido} ${x.correo}`.toLowerCase().includes(q));
  const eq = Object.fromEntries(st.equipos.map(e => [e.id, e.nombre]));
  return `<div class="acciones" style="margin-bottom:12px">
      <input class="buscador" id="buscar" placeholder="Buscar por nombre o correo" value="${h(busqueda)}">
      <button id="registrar">Registrar a alguien</button>
    </div>
    <table class="tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Equipo</th><th>Pts</th><th></th></tr></thead><tbody>
    ${lista.map(x => `<tr><td>${h(x.nombre)} ${h(x.apellido)}${x.es_facilitadora ? ' <span class="nivel">facilitadora</span>' : ''}${x.bloqueado ? ' <span class="estado abierta">bloqueado</span>' : ''}</td>
      <td><small>${h(x.correo)}</small></td><td>${h(eq[x.equipo_id] || '—')}</td><td>${x.puntos}</td>
      <td class="acciones"><button data-pin="${x.id}" data-nombre="${h(x.nombre)}">Nuevo PIN</button>
      ${x.es_facilitadora ? '' : `<button data-borrar="${x.id}" data-nombre="${h(x.nombre)} ${h(x.apellido)}">Borrar</button>`}</td></tr>`).join('')}
    </tbody></table>`;
}

function render() {
  if (!st) return;
  const activo = document.activeElement;
  if (activo && activo.tagName === 'INPUT' && $p.contains(activo) && activo.id !== 'buscar' && activo.value) return;
  // No cerrar un selector de equipo que la facilitadora tiene abierto.
  if (activo && activo.tagName === 'SELECT' && activo.id !== 'sede' && $p.contains(activo)) return;
  const pos = activo && activo.id === 'buscar' ? activo.selectionStart : null;
  const html = barra() + (tab === 'vivo' ? vistaVivo() : tab === 'equipos' ? vistaEquipos() : tab === 'entregas' ? vistaEntregas() : vistaPersonas());
  // Sin cambios no se redibuja: evita parpadeos y recargar fotos pesadas cada 3 s.
  if (html === ultimoHtml && pos === null) return;
  ultimoHtml = html;
  $p.innerHTML = html;
  enlazar();
  if (pos !== null) { const b = document.getElementById('buscar'); b.focus(); b.setSelectionRange(pos, pos); }
}

async function hacer(promesa, ok) {
  const r = await promesa;
  if (r.error === 'sesion_invalida' || r.error === 'no_autorizado') return salir(r.error);
  if (r.error) toast(mensaje(r.error)); else if (ok) toast(ok);
  await actualizar();
}

function enlazar() {
  document.getElementById('sede').onchange = (ev) => { cambiarSede(ev.target.value); st = null; actualizar(); };
  $p.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => { tab = b.dataset.tab; render(); }));
  $p.querySelectorAll('[data-act]').forEach(b => (b.onclick = () => hacer(api.f.actividad(token, sede, b.dataset.act, b.dataset.estado))));
  $p.querySelectorAll('[data-filtro]').forEach(b => (b.onclick = () => { filtroEntregas = b.dataset.filtro; render(); }));
  $p.querySelectorAll('[data-ver]').forEach(b => (b.onclick = async () => {
    const id = b.dataset.ver, version = b.dataset.version;
    if (cargandoFoto.has(id)) return;
    cargandoFoto.add(id); render();
    const r = await api.f.foto(token, id);
    cargandoFoto.delete(id);
    if (r.error) { toast(mensaje(r.error)); render(); return; }
    // La foto se guarda con la versión que se pidió: si el equipo la cambia, se vuelve a pedir.
    fotos.set(`${id}:${version}`, r.data.foto); render();
  }));
  $p.querySelectorAll('[data-revisar]').forEach(b => (b.onclick = () => {
    let motivo = null;
    if (b.dataset.estado === 'rechazado') { motivo = prompt('Motivo (opcional, lo verá el equipo):', ''); if (motivo === null) return; }
    hacer(api.f.revisar(token, b.dataset.revisar, b.dataset.estado, motivo, b.dataset.version), b.dataset.estado === 'aprobado' ? 'Aprobada' : 'Rechazada');
  }));
  $p.querySelectorAll('[data-equipos]').forEach(b => (b.onclick = () => hacer(api.f.equipos(token, sede, b.dataset.equipos))));
  $p.querySelectorAll('[data-mover]').forEach(s => (s.onchange = () => { s.blur(); hacer(api.f.mover(token, s.dataset.mover, s.value || null), 'Movida'); }));
  $p.querySelectorAll('[data-excepcion]').forEach(b => (b.onclick = () => hacer(api.f.excepcion(token, b.dataset.excepcion, b.dataset.activa === 'true'))));
  const fc = document.getElementById('fcrear');
  if (fc) fc.onsubmit = (ev) => { ev.preventDefault(); const n = ev.target.n.value; ev.target.n.value = ''; hacer(api.f.crearEquipo(token, sede, n), 'Equipo creado'); };
  const bus = document.getElementById('buscar');
  if (bus) bus.oninput = () => { busqueda = bus.value; render(); };
  $p.querySelectorAll('[data-pin]').forEach(b => (b.onclick = () => {
    const pin = prompt(`Nuevo PIN de 4 números para ${b.dataset.nombre}:`);
    if (pin) hacer(api.f.resetPin(token, b.dataset.pin, pin.trim()), 'PIN cambiado');
  }));
  $p.querySelectorAll('[data-borrar]').forEach(b => (b.onclick = () => {
    if (confirm(`¿Borrar a ${b.dataset.nombre} y todas sus respuestas? No se puede deshacer.`)) hacer(api.f.borrarPersona(token, b.dataset.borrar), 'Borrada');
  }));
  const reg = document.getElementById('registrar');
  if (reg) reg.onclick = () => {
    const nombre = prompt('Nombre:'); if (!nombre) return;
    const apellido = prompt('Apellido:'); if (!apellido) return;
    const correo = prompt('Correo (cualquier dominio):'); if (!correo) return;
    const pin = prompt('PIN de 4 números:'); if (!pin) return;
    hacer(api.f.registrar(token, sede, nombre, apellido, correo, pin.trim()), 'Registrada');
  };
}

async function actualizar() {
  const r = await api.f.estado(token, sede);
  if (r.error === 'red') { $red.hidden = false; return; }
  $red.hidden = true;
  if (r.error === 'sesion_invalida' || r.error === 'no_autorizado') return salir(r.error);
  if (r.error) return toast(mensaje(r.error));
  st = r.data;
  const re = await api.f.entregas(token, sede);
  if (!re.error) entregas = re.data;
  render();
}

function salir(codigo) {
  guardado.del(LLAVE); token = null; st = null;
  if (sondeo) sondeo.parar();
  vistaEntrada(mensaje(codigo));
}

function arrancar() { sondeo = cadaTanto(actualizar, 3000); }

if (token) arrancar(); else vistaEntrada();
