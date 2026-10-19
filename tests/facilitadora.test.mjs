import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, psql, resetPrueba, persona, facilitadora, correo } from './helpers.mjs';

beforeEach(resetPrueba);
after(resetPrueba);

test('participante no puede usar funciones de facilitadora', async () => {
  const p = await persona();
  assert.equal((await rpc('f_estado', { p_token: p.token, p_sede: 'prueba' })).error, 'no_autorizado');
});

test('f_estado devuelve actividades, personas con nivel y equipos', async () => {
  const f = await facilitadora(), p = await persona();
  await rpc('f_actividad', { p_token: f.token, p_sede: 'prueba', p_actividad: 'a1', p_estado: 'abierta' });
  await rpc('responder', { p_token: p.token, p_actividad: 'a1', p_opcion: 2, p_texto: null });
  const { data, error } = await rpc('f_estado', { p_token: f.token, p_sede: 'prueba' });
  assert.equal(error, null);
  const a1 = data.actividades.find(a => a.id === 'a1');
  assert.equal(a1.estado, 'abierta');
  assert.equal(a1.respuestas, 1);
  const yo = data.personas.find(x => x.id === p.persona.id);
  assert.equal(yo.nivel, 2);
  assert.match(yo.correo, /@cecomsa\.com$/);
  assert.equal(data.equipos_estado, 'cerrada');
});

test('abrir B cierra A; responder A después da actividad_cerrada', async () => {
  const f = await facilitadora(), p = await persona();
  const abrirF = (id) => rpc('f_actividad', { p_token: f.token, p_sede: 'prueba', p_actividad: id, p_estado: 'abierta' });
  await abrirF('a1');
  await abrirF('a3');
  assert.equal(psql(`select estado from estado_actividad where sede = 'prueba' and actividad_id = 'a1'`), 'cerrada');
  const r = await rpc('responder', { p_token: p.token, p_actividad: 'a1', p_opcion: 0, p_texto: null });
  assert.equal(r.error, 'actividad_cerrada');
});

test('abrir la actividad de equipos abre el armado; cerrarla lo deja en final', async () => {
  const f = await facilitadora();
  await rpc('f_actividad', { p_token: f.token, p_sede: 'prueba', p_actividad: 'a9', p_estado: 'abierta' });
  assert.equal(psql(`select equipos_estado from sedes where id = 'prueba'`), 'abierta');
  await rpc('f_actividad', { p_token: f.token, p_sede: 'prueba', p_actividad: 'a9', p_estado: 'cerrada' });
  assert.equal(psql(`select equipos_estado from sedes where id = 'prueba'`), 'final');
});

test('f_excepcion permite un quinto miembro; f_mover ignora el cupo', async () => {
  const f = await facilitadora();
  const ps = await Promise.all([1, 2, 3, 4, 5, 6].map(i => persona(`P${i}`)));
  psql(`update sedes set equipos_estado = 'abierta' where id = 'prueba'`);
  const { data: eq } = await rpc('crear_equipo', { p_token: ps[0].token, p_nombre: 'Grande' });
  for (const p of ps.slice(1, 4)) await rpc('unirse_equipo', { p_token: p.token, p_equipo: eq.id });
  assert.equal((await rpc('unirse_equipo', { p_token: ps[4].token, p_equipo: eq.id })).error, 'equipo_lleno');
  await rpc('f_excepcion', { p_token: f.token, p_equipo: eq.id, p_activa: true });
  assert.equal((await rpc('unirse_equipo', { p_token: ps[4].token, p_equipo: eq.id })).error, null);
  assert.equal((await rpc('f_mover', { p_token: f.token, p_persona: ps[5].persona.id, p_equipo: eq.id })).error, null);
  assert.equal(psql(`select count(*) from personas where equipo_id = '${eq.id}'`), '6');
});

test('f_crear_equipo crea equipo vacío y f_equipos cambia el estado', async () => {
  const f = await facilitadora();
  const { data } = await rpc('f_crear_equipo', { p_token: f.token, p_sede: 'prueba', p_nombre: 'Vacío' });
  assert.equal(data.nombre, 'Vacío');
  await rpc('f_equipos', { p_token: f.token, p_sede: 'prueba', p_estado: 'final' });
  assert.equal(psql(`select equipos_estado from sedes where id = 'prueba'`), 'final');
});

test('f_reset_pin desbloquea y el nuevo PIN entra', async () => {
  const f = await facilitadora();
  const c = correo();
  const { data: p } = await rpc('registrar', { p_sede: 'prueba', p_nombre: 'Olvido', p_apellido: 'Pin', p_correo: c, p_pin: '1111' });
  for (let i = 0; i < 5; i++) await rpc('entrar', { p_sede: 'prueba', p_correo: c, p_pin: '0000' });
  assert.equal((await rpc('f_reset_pin', { p_token: f.token, p_persona: p.persona.id, p_pin: '2222' })).error, null);
  assert.equal((await rpc('entrar', { p_sede: 'prueba', p_correo: c, p_pin: '2222' })).error, null);
});

test('f_registrar acepta otro dominio; f_borrar_persona borra', async () => {
  const f = await facilitadora();
  const { data, error } = await rpc('f_registrar', { p_token: f.token, p_sede: 'prueba', p_nombre: 'Externa', p_apellido: 'X', p_correo: `x${Date.now()}@gmail.com`, p_pin: '3333' });
  assert.equal(error, null);
  await rpc('f_borrar_persona', { p_token: f.token, p_persona: data.persona.id });
  assert.equal(psql(`select count(*) from personas where id = '${data.persona.id}'`), '0');
});
