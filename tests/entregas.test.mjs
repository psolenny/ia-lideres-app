import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, psql, resetPrueba, persona, facilitadora } from './helpers.mjs';

// Foto mínima válida (JPEG de 1×1) como data URL.
const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

let f;
beforeEach(async () => {
  resetPrueba();
  f = await facilitadora();
});
after(resetPrueba);

const act = (id, estado = 'abierta') => rpc('f_actividad', { p_token: f.token, p_sede: 'prueba', p_actividad: id, p_estado: estado });
const entregar = (t, a, o = {}) => rpc('entregar', { p_token: t, p_actividad: a, p_texto: o.texto ?? null, p_texto2: o.texto2 ?? null, p_foto: o.foto ?? null });
const revisar = (id, estado, motivo = null) => rpc('f_revisar', { p_token: f.token, p_entrega: id, p_estado: estado, p_motivo: motivo });

async function equipo(nombre, ...personas) {
  psql(`update sedes set equipos_estado = 'abierta' where id = 'prueba'`);
  const { data: eq } = await rpc('crear_equipo', { p_token: personas[0].token, p_nombre: nombre });
  for (const p of personas.slice(1)) await rpc('unirse_equipo', { p_token: p.token, p_equipo: eq.id });
  psql(`update sedes set equipos_estado = 'final' where id = 'prueba'`);
  return eq;
}

test('abrir una actividad de equipo no cierra la actividad en vivo, y viceversa', async () => {
  await act('a3');
  await act('h1');
  assert.equal(psql(`select estado from estado_actividad where sede = 'prueba' and actividad_id = 'a3'`), 'abierta');
  await act('a4');
  assert.equal(psql(`select estado from estado_actividad where sede = 'prueba' and actividad_id = 'h1'`), 'abierta');
  assert.equal(psql(`select estado from estado_actividad where sede = 'prueba' and actividad_id = 'a3'`), 'cerrada');
});

test('estado muestra la actividad en vivo en «actividad» y las de equipo en «tareas»', async () => {
  const a = await persona();
  await equipo('Uno', a, await persona());
  await act('a3');
  await act('h1');
  const { data } = await rpc('estado', { p_token: a.token });
  assert.equal(data.actividad.id, 'a3');
  assert.deepEqual(data.tareas.map(t => t.id), ['h1']);
  assert.equal(data.tareas[0].entrega, null);
});

test('hito: sin equipo, sin foto o cerrado se rechaza', async () => {
  const solo = await persona();
  await act('h1');
  assert.equal((await entregar(solo.token, 'h1', { foto: FOTO })).error, 'sin_equipo');
  const a = await persona();
  await equipo('Dos', a, await persona());
  assert.equal((await entregar(a.token, 'h1')).error, 'foto_invalida');
  assert.equal((await entregar(a.token, 'h1', { foto: 'data:text/html;base64,PHNjcmlwdD4=' })).error, 'foto_invalida');
  assert.equal((await entregar(a.token, 'h2', { foto: FOTO })).error, 'actividad_cerrada');
});

test('hito: el equipo entrega, ve el estado y puede reemplazar mientras está pendiente', async () => {
  const a = await persona(), b = await persona();
  await equipo('Tres', a, b);
  await act('h1');
  const r1 = await entregar(a.token, 'h1', { foto: FOTO, texto: 'Elegimos reportes' });
  assert.equal(r1.error, null);
  assert.equal(r1.data.estado, 'pendiente');
  const r2 = await entregar(b.token, 'h1', { foto: FOTO });
  assert.equal(r2.data.id, r1.data.id);
  const { data } = await rpc('estado', { p_token: a.token });
  assert.equal(data.tareas[0].entrega.estado, 'pendiente');
  assert.equal(data.tareas[0].entrega.subio, 'Ana P.');
  assert.equal(psql(`select count(*) from entregas where actividad_id = 'h1'`), '1');
});

test('aprobado ya no se reemplaza; rechazado sí, con motivo visible', async () => {
  const a = await persona(), b = await persona();
  await equipo('Cuatro', a, b);
  await act('h1');
  const { data: e } = await entregar(a.token, 'h1', { foto: FOTO });
  await revisar(e.id, 'rechazado', 'No se ve la pantalla');
  let st = (await rpc('estado', { p_token: b.token })).data;
  assert.equal(st.tareas[0].entrega.estado, 'rechazado');
  assert.equal(st.tareas[0].entrega.motivo, 'No se ve la pantalla');
  const r = await entregar(b.token, 'h1', { foto: FOTO });
  assert.equal(r.data.estado, 'pendiente');
  await revisar(e.id, 'aprobado');
  assert.equal((await entregar(a.token, 'h1', { foto: FOTO })).error, 'ya_aprobado');
});

test('puntos de equipo: hitos aprobados con bono de colaboración', async () => {
  const a = await persona('A1'), b = await persona('A2'), c = await persona('B1'), d = await persona('B2');
  await equipo('Colaboran', a, b);
  await equipo('Solitario', c, d);
  await act('h1'); await act('h2');
  // Colaboran: dos personas distintas suben → 100 %
  await revisar((await entregar(a.token, 'h1', { foto: FOTO })).data.id, 'aprobado');
  await revisar((await entregar(b.token, 'h2', { foto: FOTO })).data.id, 'aprobado');
  // Solitario: la misma persona sube todo → 60 %
  await revisar((await entregar(c.token, 'h1', { foto: FOTO })).data.id, 'aprobado');
  await revisar((await entregar(c.token, 'h2', { foto: FOTO })).data.id, 'aprobado');
  const { data } = await rpc('pantalla', { p_sede: 'prueba' });
  const pts = Object.fromEntries(data.ranking.equipos.map(e => [e.nombre, e.puntos]));
  assert.equal(pts['Colaboran'], 200);
  assert.equal(pts['Solitario'], 120);
});

test('texto de equipo: mejor prompt y error cazado', async () => {
  const a = await persona(), b = await persona();
  await equipo('Textos', a, b);
  await act('t1');
  assert.equal((await entregar(a.token, 't1', { texto: 'corto' })).error, 'texto_invalido');
  const { data: e } = await entregar(a.token, 't1', { texto: 'Actúa como analista de inventario y resume...' });
  await revisar(e.id, 'aprobado');
  const { data } = await rpc('pantalla', { p_sede: 'prueba' });
  assert.equal(data.ranking.equipos[0].puntos, 50);
});

test('check-in: personal, editable, puntos y bono si lo entrega todo el equipo', async () => {
  const a = await persona('C1'), b = await persona('C2');
  await equipo('Check', a, b);
  await act('c1');
  assert.equal((await entregar(a.token, 'c1', { texto: 'Usé la IA para el reporte semanal' })).error, 'texto_invalido');
  const ok = await entregar(a.token, 'c1', { texto: 'Usé la IA para el reporte semanal', texto2: 'Preparé la agenda de la reunión' });
  assert.equal(ok.data.estado, 'aprobado');
  const otra = await entregar(a.token, 'c1', { texto: 'Cambié: resumen del informe mensual', texto2: 'Preparé la agenda de la reunión' });
  assert.equal(otra.data.id, ok.data.id);
  let eq = (await rpc('pantalla', { p_sede: 'prueba' })).data.ranking.equipos[0];
  assert.equal(eq.puntos, 25); // promedio personal (50 + 0) / 2, sin bono
  await entregar(b.token, 'c1', { texto: 'Le pedí ideas para el plan de ventas', texto2: 'Revisé un correo difícil' });
  eq = (await rpc('pantalla', { p_sede: 'prueba' })).data.ranking.equipos[0];
  assert.equal(eq.puntos, 150); // 50 de promedio + 100 de bono
  const pp = (await rpc('pantalla', { p_sede: 'prueba' })).data.ranking.personas;
  assert.equal(pp[0].puntos, 50);
});

test('panel: lista entregas sin foto, trae la foto aparte y solo la facilitadora', async () => {
  const a = await persona(), b = await persona();
  await equipo('Panel', a, b);
  await act('h1');
  await entregar(a.token, 'h1', { foto: FOTO, texto: 'nota' });
  const { data } = await rpc('f_entregas', { p_token: f.token, p_sede: 'prueba' });
  assert.equal(data.length, 1);
  assert.equal(data[0].foto, undefined);
  assert.equal(data[0].tiene_foto, true);
  assert.equal(data[0].equipo, 'Panel');
  const foto = await rpc('f_foto', { p_token: f.token, p_entrega: data[0].id });
  assert.equal(foto.data.foto, FOTO);
  assert.equal((await rpc('f_entregas', { p_token: a.token, p_sede: 'prueba' })).error, 'no_autorizado');
  assert.equal((await rpc('f_foto', { p_token: a.token, p_entrega: data[0].id })).error, 'no_autorizado');
});

test('foto demasiado grande se rechaza', async () => {
  const a = await persona(), b = await persona();
  await equipo('Grande', a, b);
  await act('h1');
  const enorme = 'data:image/jpeg;base64,' + 'A'.repeat(1_200_000);
  assert.equal((await entregar(a.token, 'h1', { foto: enorme })).error, 'foto_invalida');
});
