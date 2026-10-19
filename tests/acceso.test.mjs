import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, rest, psql, correo, resetPrueba } from './helpers.mjs';

beforeEach(resetPrueba);
after(resetPrueba);

const reg = (o = {}) => rpc('registrar', { p_sede: 'prueba', p_nombre: 'Ana', p_apellido: 'Pérez', p_correo: correo(), p_pin: '1234', ...o });

test('registrar crea persona y devuelve token', async () => {
  const { data, error } = await reg();
  assert.equal(error, null);
  assert.match(data.token, /^[0-9a-f-]{36}$/);
  assert.equal(data.persona.nombre, 'Ana');
  assert.equal(data.persona.es_facilitadora, false);
});

test('correo fuera de cecomsa se rechaza', async () => {
  assert.equal((await reg({ p_correo: 'ana@gmail.com' })).error, 'correo_invalido');
});

test('pin de 3 dígitos o con letras se rechaza', async () => {
  assert.equal((await reg({ p_pin: '123' })).error, 'pin_invalido');
  assert.equal((await reg({ p_pin: '12a4' })).error, 'pin_invalido');
});

test('nombre vacío o sede inexistente se rechaza', async () => {
  assert.equal((await reg({ p_nombre: '  ' })).error, 'datos_incompletos');
  assert.equal((await reg({ p_sede: 'xx' })).error, 'sede_invalida');
});

test('correo repetido en la misma sede', async () => {
  const c = correo();
  await reg({ p_correo: c });
  assert.equal((await reg({ p_correo: c })).error, 'ya_registrado');
});

test('mismo correo en otra sede sí se permite', async () => {
  const c = correo();
  assert.equal((await reg({ p_correo: c })).error, null);
  const otra = await reg({ p_correo: c, p_sede: 'prueba2' });
  psql(`delete from personas where sede = 'prueba2' and correo = '${c}'`);
  assert.equal(otra.error, null);
});

test('correo con mayúsculas y espacios entra con cualquier variante', async () => {
  const base = correo();
  const raro = ` ${base.toUpperCase()} `;
  assert.equal((await reg({ p_correo: raro })).error, null);
  const { data, error } = await rpc('entrar', { p_sede: 'prueba', p_correo: base, p_pin: '1234' });
  assert.equal(error, null);
  assert.match(data.token, /^[0-9a-f-]{36}$/);
});

test('PIN incorrecto y bloqueo tras 5 fallos', async () => {
  const c = correo();
  await reg({ p_correo: c });
  for (let i = 0; i < 5; i++) {
    assert.equal((await rpc('entrar', { p_sede: 'prueba', p_correo: c, p_pin: '9999' })).error, 'credenciales');
  }
  assert.equal((await rpc('entrar', { p_sede: 'prueba', p_correo: c, p_pin: '1234' })).error, 'bloqueado');
});

test('correo no registrado da credenciales', async () => {
  assert.equal((await rpc('entrar', { p_sede: 'prueba', p_correo: correo(), p_pin: '1234' })).error, 'credenciales');
});

test('anon no puede leer tablas directamente', async () => {
  for (const t of ['personas', 'sesiones', 'respuestas']) {
    const r = await rest(`${t}?select=*`);
    assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: ${r.status}`);
  }
});
