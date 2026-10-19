import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, psql, resetPrueba, persona } from './helpers.mjs';

beforeEach(() => {
  resetPrueba();
  psql(`update sedes set equipos_estado = 'abierta' where id = 'prueba'`);
});
after(resetPrueba);

const crear = (t, nombre) => rpc('crear_equipo', { p_token: t, p_nombre: nombre });
const unirse = (t, id) => rpc('unirse_equipo', { p_token: t, p_equipo: id });
const salir = (t) => rpc('salir_equipo', { p_token: t });
const miembros = (id) => Number(psql(`select count(*) from personas where equipo_id = '${id}'`));

test('crear y unirse hasta 4; el quinto recibe equipo_lleno', async () => {
  const ps = await Promise.all([1, 2, 3, 4, 5].map(i => persona(`P${i}`)));
  const { data: eq } = await crear(ps[0].token, 'Los Rápidos');
  assert.equal(eq.nombre, 'Los Rápidos');
  for (const p of ps.slice(1, 4)) assert.equal((await unirse(p.token, eq.id)).error, null);
  assert.equal(miembros(eq.id), 4);
  assert.equal((await unirse(ps[4].token, eq.id)).error, 'equipo_lleno');
});

test('dos uniones simultáneas al último cupo: entra solo una', async () => {
  const ps = await Promise.all([1, 2, 3, 4, 5].map(i => persona(`P${i}`)));
  const { data: eq } = await crear(ps[0].token, 'Carrera');
  await unirse(ps[1].token, eq.id);
  await unirse(ps[2].token, eq.id);
  const [a, b] = await Promise.all([unirse(ps[3].token, eq.id), unirse(ps[4].token, eq.id)]);
  const errores = [a.error, b.error];
  assert.equal(errores.filter(e => e === null).length, 1);
  assert.equal(errores.filter(e => e === 'equipo_lleno').length, 1);
  assert.equal(miembros(eq.id), 4);
});

test('no puede estar en dos equipos', async () => {
  const a = await persona(), b = await persona();
  const { data: e1 } = await crear(a.token, 'Uno');
  await crear(b.token, 'Dos');
  assert.equal((await unirse(b.token, e1.id)).error, 'ya_tienes_equipo');
  assert.equal((await crear(a.token, 'Tres')).error, 'ya_tienes_equipo');
});

test('con equipos cerrados no se puede crear ni unirse', async () => {
  const a = await persona(), b = await persona();
  const { data: eq } = await crear(a.token, 'Antes');
  psql(`update sedes set equipos_estado = 'final' where id = 'prueba'`);
  assert.equal((await crear(b.token, 'Tarde')).error, 'equipos_cerrado');
  assert.equal((await unirse(b.token, eq.id)).error, 'equipos_cerrado');
  assert.equal((await salir(a.token)).error, 'equipos_cerrado');
});

test('salir deja el equipo; si queda vacío se borra', async () => {
  const a = await persona(), b = await persona();
  const { data: eq } = await crear(a.token, 'Temporal');
  await unirse(b.token, eq.id);
  assert.equal((await salir(b.token)).error, null);
  assert.equal(miembros(eq.id), 1);
  await salir(a.token);
  assert.equal(psql(`select count(*) from equipos where id = '${eq.id}'`), '0');
});

test('nombre repetido sin importar mayúsculas; nombre vacío o largo', async () => {
  const a = await persona(), b = await persona();
  await crear(a.token, 'Innova');
  assert.equal((await crear(b.token, ' INNOVA ')).error, 'nombre_repetido');
  assert.equal((await crear(b.token, '   ')).error, 'nombre_invalido');
  assert.equal((await crear(b.token, 'x'.repeat(31))).error, 'nombre_invalido');
});

test('equipo de otra sede no existe para mí', async () => {
  const a = await persona(), sdP = await persona('Otra', 'Sede', 'sd');
  psql(`update sedes set equipos_estado = 'abierta' where id = 'sd'`);
  try {
    const { data: eq } = await crear(sdP.token, `SD ${Date.now()}`);
    assert.equal((await unirse(a.token, eq.id)).error, 'equipo_no_existe');
  } finally {
    psql(`update personas set equipo_id = null where id = '${sdP.persona.id}';
          delete from equipos where sede = 'sd'; delete from personas where id = '${sdP.persona.id}';
          update sedes set equipos_estado = 'cerrada' where id = 'sd'`);
  }
});
