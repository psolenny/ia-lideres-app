import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, psql, resetPrueba, persona, facilitadora } from './helpers.mjs';

let f;
beforeEach(async () => { resetPrueba(); f = await facilitadora(); });
after(resetPrueba);

const bono = (o) => rpc('f_bono', { p_token: f.token, p_persona: o.persona ?? null, p_equipo: o.equipo ?? null, p_puntos: o.puntos, p_motivo: o.motivo ?? 'Participación destacada' });

async function equipo(nombre, ...ps) {
  psql(`update sedes set equipos_estado = 'abierta' where id = 'prueba'`);
  const { data: eq } = await rpc('crear_equipo', { p_token: ps[0].token, p_nombre: nombre });
  for (const p of ps.slice(1)) await rpc('unirse_equipo', { p_token: p.token, p_equipo: eq.id });
  return eq;
}

test('bono a una persona suma a su puntaje y al promedio de su equipo', async () => {
  const a = await persona('Ana'), b = await persona('Beto');
  await equipo('Uno', a, b);
  const r = await bono({ persona: a.persona.id, puntos: 30, motivo: 'Ayudó a otro equipo' });
  assert.equal(r.error, null);
  const st = (await rpc('estado', { p_token: a.token })).data;
  assert.equal(st.yo.puntos, 30);
  assert.equal(st.ranking.personas[0].puntos, 30);
  assert.equal(st.ranking.equipos[0].puntos, 15);   // promedio (30 + 0) / 2
});

test('bono a un equipo suma solo al equipo', async () => {
  const a = await persona('Ana'), b = await persona('Beto');
  const eq = await equipo('Dos', a, b);
  assert.equal((await bono({ equipo: eq.id, puntos: 50, motivo: 'Mejor demo' })).error, null);
  const st = (await rpc('estado', { p_token: a.token })).data;
  assert.equal(st.yo.puntos, 0);
  assert.equal(st.ranking.equipos[0].puntos, 50);
});

test('bono negativo permitido para corregir; sin motivo o sin destino se rechaza', async () => {
  const a = await persona();
  await bono({ persona: a.persona.id, puntos: 40 });
  assert.equal((await bono({ persona: a.persona.id, puntos: -10, motivo: 'Corrección' })).error, null);
  assert.equal((await rpc('estado', { p_token: a.token })).data.yo.puntos, 30);
  assert.equal((await bono({ persona: a.persona.id, puntos: 10, motivo: 'ab' })).error, 'motivo_invalido');
  assert.equal((await bono({ puntos: 10 })).error, 'destino_invalido');
  assert.equal((await bono({ persona: a.persona.id, puntos: 0 })).error, 'puntos_invalidos');
});

test('solo la facilitadora otorga; el panel lista los bonos y puede quitarlos', async () => {
  const a = await persona('Ana');
  assert.equal((await rpc('f_bono', { p_token: a.token, p_persona: a.persona.id, p_equipo: null, p_puntos: 10, p_motivo: 'Trampa' })).error, 'no_autorizado');
  const { data: b } = await bono({ persona: a.persona.id, puntos: 25, motivo: 'Primero en terminar' });
  let st = (await rpc('f_estado', { p_token: f.token, p_sede: 'prueba' })).data;
  assert.equal(st.bonos.length, 1);
  assert.equal(st.bonos[0].destino, 'Ana P.');
  assert.equal(st.bonos[0].puntos, 25);
  assert.equal(st.personas.find(x => x.id === a.persona.id).puntos, 25);
  assert.equal(st.ranking.personas[0].puntos, 25);
  assert.equal((await rpc('f_quitar_bono', { p_token: f.token, p_bono: b.id })).error, null);
  st = (await rpc('f_estado', { p_token: f.token, p_sede: 'prueba' })).data;
  assert.equal(st.bonos.length, 0);
  assert.equal(st.personas.find(x => x.id === a.persona.id).puntos, 0);
});

test('f_estado trae el ranking de personas y equipos con desglose', async () => {
  const a = await persona('Ana'), b = await persona('Beto');
  const eq = await equipo('Tres', a, b);
  await bono({ equipo: eq.id, puntos: 20, motivo: 'Colaboración' });
  await bono({ persona: b.persona.id, puntos: 10, motivo: 'Buena pregunta' });
  const st = (await rpc('f_estado', { p_token: f.token, p_sede: 'prueba' })).data;
  assert.equal(st.ranking.personas[0].nombre, 'Beto P.');
  assert.equal(st.ranking.personas[0].bonos, 10);
  assert.equal(st.ranking.equipos[0].nombre, 'Tres');
  assert.equal(st.ranking.equipos[0].puntos, 25);     // promedio 5 + bono 20
  assert.equal(st.ranking.equipos[0].bonos, 20);
  assert.equal(st.ranking.equipos[0].miembros, 2);
});
