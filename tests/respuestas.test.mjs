import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, psql, resetPrueba, persona, abrir } from './helpers.mjs';

beforeEach(resetPrueba);
after(resetPrueba);

const responder = (token, actividad, opcion = null, texto = null) =>
  rpc('responder', { p_token: token, p_actividad: actividad, p_opcion: opcion, p_texto: texto });

test('puntos_quiz: bono de rapidez', () => {
  const q = (s) => Number(psql(`select puntos_quiz(50, ${s})`));
  assert.equal(q(5), 100);
  assert.equal(q(20), 100);
  assert.equal(q(40), 75);
  assert.equal(q(60), 50);
  assert.equal(q(90), 50);
});

test('encuesta abierta da 10 puntos', async () => {
  const { token } = await persona();
  abrir('a1');
  const { data, error } = await responder(token, 'a1', 2);
  assert.equal(error, null);
  assert.equal(data.puntos, 10);
  assert.equal(data.correcta, null);
});

test('quiz correcto rápido da 100; incorrecto da 0 con explicación', async () => {
  const a = await persona(), b = await persona('Beto');
  abrir('a3');
  const bien = await responder(a.token, 'a3', 0);
  assert.equal(bien.data.correcta, true);
  assert.equal(bien.data.puntos, 100);
  const mal = await responder(b.token, 'a3', 2);
  assert.equal(mal.data.correcta, false);
  assert.equal(mal.data.puntos, 0);
  assert.equal(mal.data.correcta_idx, 0);
  assert.ok(mal.data.explicacion.length > 10);
});

test('quiz respondido a los 40 s da 75', async () => {
  const { token } = await persona();
  abrir('a3', 'prueba', 40);
  const { data } = await responder(token, 'a3', 0);
  assert.ok(data.puntos >= 74 && data.puntos <= 75, String(data.puntos));
});

test('actividad no abierta', async () => {
  const { token } = await persona();
  assert.equal((await responder(token, 'a1', 0)).error, 'actividad_cerrada');
});

test('opción fuera de rango', async () => {
  const { token } = await persona();
  abrir('a1');
  assert.equal((await responder(token, 'a1', 9)).error, 'opcion_invalida');
  assert.equal((await responder(token, 'a1', null)).error, 'opcion_invalida');
});

test('nube guarda en minúsculas; vacío o 5 palabras se rechaza', async () => {
  const a = await persona(), b = await persona(), c = await persona();
  abrir('a2');
  const ok = await responder(a.token, 'a2', null, '  Reportes Semanales ');
  assert.equal(ok.error, null);
  assert.equal(ok.data.puntos, 10);
  assert.equal(psql(`select texto from respuestas where persona_id = '${a.persona.id}'`), 'reportes semanales');
  assert.equal((await responder(b.token, 'a2', null, '   ')).error, 'texto_invalido');
  assert.equal((await responder(c.token, 'a2', null, 'uno dos tres cuatro cinco')).error, 'texto_invalido');
});

test('responder dos veces devuelve lo mismo y no duplica', async () => {
  const p = await persona();
  abrir('a3');
  const r1 = await responder(p.token, 'a3', 0);
  const r2 = await responder(p.token, 'a3', 1);
  assert.deepEqual(r2.data, r1.data);
  assert.equal(psql(`select count(*) from respuestas where persona_id = '${p.persona.id}'`), '1');
});

test('actividad abierta solo en sd no se puede responder desde prueba', async () => {
  const { token } = await persona();
  abrir('a1', 'sd');
  try {
    assert.equal((await responder(token, 'a1', 0)).error, 'actividad_cerrada');
  } finally {
    psql(`update estado_actividad set estado = 'cerrada', abierta_en = null where sede = 'sd'`);
  }
});

test('token inválido', async () => {
  assert.equal((await responder('00000000-0000-0000-0000-000000000000', 'a1', 0)).error, 'sesion_invalida');
});
