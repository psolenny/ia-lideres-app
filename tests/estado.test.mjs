import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, psql, resetPrueba, persona, facilitadora, abrir } from './helpers.mjs';

beforeEach(resetPrueba);
after(resetPrueba);

const estado = (t) => rpc('estado', { p_token: t });
const responder = (t, a, o = null, x = null) => rpc('responder', { p_token: t, p_actividad: a, p_opcion: o, p_texto: x });

test('estado sin actividad abierta', async () => {
  const p = await persona();
  const { data, error } = await estado(p.token);
  assert.equal(error, null);
  assert.equal(data.actividad, null);
  assert.equal(data.yo.nombre, 'Ana');
  assert.equal(data.yo.puntos, 0);
  assert.equal(data.yo.equipo, null);
});

test('quiz abierto no revela la correcta antes de responder; después sí', async () => {
  const p = await persona();
  abrir('a3');
  const antes = (await estado(p.token)).data;
  assert.equal(antes.actividad.id, 'a3');
  assert.equal(antes.actividad.mi_respuesta, null);
  assert.ok(!JSON.stringify(antes).includes('correcta_idx'));
  assert.ok(!JSON.stringify(antes).includes('Si no tuvo la información'));
  await responder(p.token, 'a3', 1);
  const despues = (await estado(p.token)).data;
  assert.equal(despues.actividad.mi_respuesta.correcta_idx, 0);
  assert.equal(despues.actividad.mi_respuesta.correcta, false);
});

test('ranking de equipos usa el promedio y excluye a la facilitadora', async () => {
  const f = await facilitadora();
  const a1 = await persona('A1'), a2 = await persona('A2'), b1 = await persona('B1');
  psql(`update sedes set equipos_estado = 'abierta' where id = 'prueba'`);
  const { data: ea } = await rpc('crear_equipo', { p_token: a1.token, p_nombre: 'Equipo A' });
  await rpc('unirse_equipo', { p_token: a2.token, p_equipo: ea.id });
  await rpc('crear_equipo', { p_token: b1.token, p_nombre: 'Equipo B' });
  abrir('a3');
  await responder(a1.token, 'a3', 0);          // 100
  await responder(a2.token, 'a3', 2);          // 0
  abrir('a3', 'prueba', 50);
  psql(`delete from respuestas where actividad_id = 'a3' and persona_id = '${b1.persona.id}'`);
  await responder(b1.token, 'a3', 0);          // 50 + 13 = 63
  await responder(f.token, 'a3', 0);
  const { data } = await estado(a1.token);
  const eqs = data.ranking.equipos;
  assert.equal(eqs[0].nombre, 'Equipo B');
  assert.equal(eqs[1].nombre, 'Equipo A');
  assert.equal(eqs[1].puntos, 50);
  assert.equal(eqs[1].yo, true);
  assert.ok(!data.ranking.personas.some(x => x.nombre.startsWith('Sole')));
  assert.equal(data.ranking.personas[0].nombre, 'A1 P.');
});

test('nombre corto', () => {
  assert.equal(psql(`select nombre_corto('ana maría', 'pérez')`), 'ana maría P.');
});

test('pantalla no incluye correos y cuenta respuestas', async () => {
  const a = await persona(), b = await persona(), c = await persona();
  abrir('a1');
  await responder(a.token, 'a1', 0);
  await responder(b.token, 'a1', 0);
  await responder(c.token, 'a1', 3);
  let { data } = await rpc('pantalla', { p_sede: 'prueba' });
  assert.equal(data.actividad.id, 'a1');
  assert.equal(data.resultados.respondieron, 3);
  assert.equal(data.resultados.conteo, undefined);
  psql(`update estado_actividad set estado = 'resultados' where sede = 'prueba' and actividad_id = 'a1'`);
  ({ data } = await rpc('pantalla', { p_sede: 'prueba' }));
  assert.deepEqual(data.resultados.conteo, [2, 0, 0, 1]);
  assert.ok(!JSON.stringify(data).includes('@'));
});

test('pantalla: nube y primeros en acertar', async () => {
  const a = await persona('Primera'), b = await persona('Segundo');
  abrir('a2');
  await responder(a.token, 'a2', null, 'Reportes');
  await responder(b.token, 'a2', null, 'reportes');
  psql(`update estado_actividad set estado = 'resultados' where sede = 'prueba' and actividad_id = 'a2'`);
  let { data } = await rpc('pantalla', { p_sede: 'prueba' });
  assert.deepEqual(data.resultados.palabras, [{ texto: 'reportes', n: 2 }]);
  abrir('a3');
  await responder(a.token, 'a3', 0);
  await responder(b.token, 'a3', 0);
  psql(`update estado_actividad set estado = 'resultados' where sede = 'prueba' and actividad_id = 'a3'`);
  ({ data } = await rpc('pantalla', { p_sede: 'prueba' }));
  assert.deepEqual(data.resultados.primeros, ['Primera P.', 'Segundo P.']);
  assert.equal(data.actividad.correcta, 0);
});

test('pantalla con sede inválida', async () => {
  assert.equal((await rpc('pantalla', { p_sede: 'xx' })).error, 'sede_invalida');
});
