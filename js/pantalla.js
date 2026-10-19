// Pantalla para proyectar: sin menús ni datos personales. Tecla M alterna al marcador.
import { sedeDeURL, mensaje, escapar as h } from './util.js';
import { crearApi, cadaTanto } from './api.js';

const api = crearApi(window.IAL_CONFIG);
const sede = sedeDeURL(location.search);
const $s = document.getElementById('pantalla');
const LETRAS = 'ABCDEFGH';
const COLORES = ['#002F6C', '#E31C79', '#A20067'];
const urlParticipante = location.href.replace(/pantalla\.html.*$/, '') + `?sede=${sede}`;

let forzarMarcador = false;
let ultimaFirma = '';
let ultimo = null;

function qr() {
  try {
    const q = window.qrcode(0, 'M');
    q.addData(urlParticipante);
    q.make();
    return `<div class="qr">${q.createImgTag(8, 0)}</div>`;
  } catch {
    return '';
  }
}

function pie(d) {
  return `<div class="pie"><span>${h(d.sede)} · ${h(urlParticipante.replace(/^https?:\/\//, ''))}</span><img src="assets/logo.svg" alt="CECOMSA"></div>`;
}

function filas(lista, top) {
  if (!lista.length) return '<p class="sub">Aún no hay puntos.</p>';
  return `<ol class="ranking">${lista.map(x => `<li class="${x.puesto <= top ? 'top' : ''}">
    <span class="pos">${x.puesto}</span><span class="nom">${h(x.nombre)}</span><span class="pt">${x.puntos}</span></li>`).join('')}</ol>`;
}

function vistaMarcador(d) {
  return `<p class="meta">Marcador</p>
    <div class="marcador">
      <div><h2>Equipos destacados</h2>${filas(d.ranking.equipos.slice(0, 10), 2)}</div>
      <div><h2>Personas destacadas</h2>${filas(d.ranking.personas, 3)}</div>
    </div>`;
}

function vistaEquipos(d) {
  const eq = d.equipos;
  return `<p class="meta">Armado de equipos · de 2 a 4</p><h1>Armen sus equipos</h1>
    <div class="abierta-grid"><div class="equipos-pantalla">
      ${eq.lista.map(e => `<div class="tarjeta-eq ${e.miembros.length < 2 && !e.excepcion ? 'incompleto' : ''}"><h4><span>${h(e.nombre)}</span><small>${e.miembros.length}/${e.cupo_max}</small></h4>
        <div class="chips">${e.miembros.map(n => `<span class="chip">${h(n)}</span>`).join('')}</div></div>`).join('')}
      ${eq.sin_equipo.length ? `<div class="tarjeta-eq"><h4><span>Sin equipo</span><small>${eq.sin_equipo.length}</small></h4>
        <div class="chips">${eq.sin_equipo.map(n => `<span class="chip">${h(n)}</span>`).join('')}</div></div>` : ''}
    </div>${qr()}</div>`;
}

function vistaAbierta(d) {
  const a = d.actividad;
  const tipo = a.tipo === 'quiz' ? 'Pregunta' : a.tipo === 'nube' ? 'Nube de palabras' : 'Encuesta';
  const ops = a.opciones ? `<div class="barras">${a.opciones.map((o, i) => `<div class="barra-res"><span class="txt"><b>${LETRAS[i]}</b> · ${h(o)}</span></div>`).join('')}</div>` : '';
  return `<p class="meta">${tipo} · responde en tu celular</p><h1>${h(a.pregunta)}</h1>
    <div class="abierta-grid"><div>${ops}<p class="contador" style="margin-top:3vh">${d.resultados.respondieron} respondieron</p></div>${qr()}</div>`;
}

function vistaResultados(d) {
  const a = d.actividad, r = d.resultados;
  let cuerpo = '';
  if (a.tipo === 'nube') {
    const max = Math.max(1, ...r.palabras.map(p => p.n));
    cuerpo = `<div class="nube">${r.palabras.map((p, i) =>
      `<span style="font-size:${(1.4 + 4.2 * (p.n / max)).toFixed(2)}vw;color:${COLORES[i % 3]}">${h(p.texto)}</span>`).join('') || '<p class="sub">Sin respuestas.</p>'}</div>`;
  } else {
    const total = Math.max(1, r.conteo.reduce((s, n) => s + n, 0));
    cuerpo = `<div class="barras">${a.opciones.map((o, i) => `
      <div class="barra-res ${a.correcta === i ? 'correcta' : ''}">
        <span class="txt"><b>${LETRAS[i]}</b> · ${h(o)}${a.correcta === i ? ' ✓' : ''}</span>
        <div class="pista"><div class="relleno" style="width:${Math.round(100 * r.conteo[i] / total)}%"></div></div>
        <span class="num">${r.conteo[i]}</span>
      </div>`).join('')}</div>`;
    if (a.tipo === 'quiz' && r.primeros.length) {
      cuerpo += `<p class="primeros">Primeros en acertar: ${r.primeros.map((n, i) => `<b>${i + 1}.</b> ${h(n)}`).join(' &nbsp; ')}</p>`;
    }
  }
  return `<p class="meta">Resultados · ${r.respondieron} respuestas</p><h1>${h(a.pregunta)}</h1>${cuerpo}`;
}

function render(d) {
  let html;
  if (forzarMarcador) html = vistaMarcador(d);
  else if (d.actividad && d.actividad.tipo === 'equipos' && d.equipos) html = vistaEquipos(d);
  else if (d.actividad && d.actividad.estado === 'resultados') html = vistaResultados(d);
  else if (d.actividad && d.actividad.estado === 'abierta') html = vistaAbierta(d);
  else html = vistaMarcador(d);
  html = `<div>${html}</div>` + pie(d);
  if (html === ultimaFirma) return;
  ultimaFirma = html;
  $s.innerHTML = html;
}

async function actualizar() {
  const r = await api.pantalla(sede);
  if (r.error) return;
  ultimo = r.data;
  render(ultimo);
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'm' || ev.key === 'M') { forzarMarcador = !forzarMarcador; if (ultimo) render(ultimo); }
});

if (!sede) $s.innerHTML = `<h1>${h(mensaje('sede_invalida'))}</h1>`;
else cadaTanto(actualizar, 2000);
