import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearGuardado, sedeDeURL, validarRegistro, mensaje } from '../js/util.js';

test('crearGuardado con storage que lanza sigue funcionando en memoria', () => {
  const roto = { getItem() { throw 0; }, setItem() { throw 0; }, removeItem() { throw 0; } };
  const s = crearGuardado(roto);
  s.set('a', '1');
  assert.equal(s.get('a'), '1');
  s.del('a');
  assert.equal(s.get('a'), null);
});

test('crearGuardado sin storage disponible funciona en memoria', () => {
  const s = crearGuardado(null);
  s.set('k', 'v');
  assert.equal(s.get('k'), 'v');
});

test('crearGuardado usa el storage cuando funciona', () => {
  const m = new Map();
  const ok = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  crearGuardado(ok).set('x', '9');
  assert.equal(m.get('x'), '9');
});

test('sedeDeURL', () => {
  assert.equal(sedeDeURL('?sede=sd'), 'sd');
  assert.equal(sedeDeURL('?sede=santiago&x=1'), 'santiago');
  assert.equal(sedeDeURL('?sede=prueba'), 'prueba');
  assert.equal(sedeDeURL('?sede=demo'), 'demo');
  assert.equal(sedeDeURL('?sede=xx'), null);
  assert.equal(sedeDeURL(''), null);
});

test('validarRegistro', () => {
  const bueno = { nombre: 'Ana', apellido: 'Pérez', correo: ' Ana.Perez@CECOMSA.com ', pin: '0427' };
  assert.equal(validarRegistro(bueno), null);
  assert.equal(validarRegistro({ ...bueno, correo: 'ana@gmail.com' }), 'correo_invalido');
  assert.equal(validarRegistro({ ...bueno, correo: 'ana@cecomsa.com.do' }), 'correo_invalido');
  assert.equal(validarRegistro({ ...bueno, pin: '12a4' }), 'pin_invalido');
  assert.equal(validarRegistro({ ...bueno, pin: '123' }), 'pin_invalido');
  assert.equal(validarRegistro({ ...bueno, nombre: '  ' }), 'datos_incompletos');
});

test('mensaje traduce códigos y tiene uno genérico', () => {
  assert.equal(mensaje('equipo_lleno'), 'Ese equipo ya está completo');
  assert.equal(mensaje('correo_invalido'), 'Usa tu correo @cecomsa.com');
  assert.equal(mensaje('cualquier_cosa'), 'Algo falló. Intenta de nuevo');
});

import { crearApi } from '../js/api.js';

test('api: error de red da "red"; responder reintenta y luego funciona', async () => {
  let llamadas = 0;
  const fetcher = async () => {
    llamadas++;
    if (llamadas < 2) throw new Error('offline');
    return { ok: true, json: async () => ({ puntos: 10 }) };
  };
  const api = crearApi({ url: 'https://x', anonKey: 'k' }, fetcher);
  const r = await api.responder('t', 'a1', 0);
  assert.equal(r.error, null);
  assert.equal(r.data.puntos, 10);
  assert.equal(llamadas, 2);
});

test('api: {error} en el cuerpo y mensaje de excepción se vuelven código', async () => {
  const api1 = crearApi({ url: 'x', anonKey: 'k' }, async () => ({ ok: true, json: async () => ({ error: 'credenciales' }) }));
  assert.equal((await api1.entrar('prueba', 'a@cecomsa.com', '1')).error, 'credenciales');
  const api2 = crearApi({ url: 'x', anonKey: 'k' }, async () => ({ ok: false, status: 400, json: async () => ({ message: 'equipo_lleno' }) }));
  assert.equal((await api2.unirseEquipo('t', 'e')).error, 'equipo_lleno');
});

test('I2: una llamada colgada se corta y devuelve "red"', { timeout: 3000 }, async () => {
  // Sin señal de corte, la llamada queda colgada para siempre (como con mal wifi).
  const colgada = (url, opts) => new Promise((_, rechazar) => opts?.signal?.addEventListener('abort', () => rechazar(new Error('abort'))));
  const api = crearApi({ url: 'x', anonKey: 'k', timeoutMs: 50 }, colgada);
  const t0 = Date.now();
  assert.equal((await api.estado('t')).error, 'red');
  assert.ok(Date.now() - t0 < 1000);
});

test('I6: sedeDeURL funciona sin Object.hasOwn (navegadores viejos)', () => {
  const original = Object.hasOwn;
  try {
    delete Object.hasOwn;
    assert.equal(sedeDeURL('?sede=santiago'), 'santiago');
  } finally {
    Object.hasOwn = original;
  }
});
