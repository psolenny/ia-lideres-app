// Prueba de carga: N personas en la sede «prueba», como en el salón.
// Cada celular consulta estado cada 3 s; la pantalla cada 2 s; el panel cada 3 s.
// En el peor momento, todas responden un quiz dentro de una ventana de 5 s.
// Uso: node scripts/carga.mjs [personas=50] [segundos=90]
import { readFileSync } from 'node:fs';

const N = Number(process.argv[2] || 50);
const DUR = Number(process.argv[3] || 90) * 1000;
const SEDE = 'prueba';
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

const tiempos = {};   // por función: lista de ms
const errores = {};
async function rpc(nombre, args) {
  if (args.p_sede && args.p_sede !== SEDE) throw new Error('solo_prueba');
  const t0 = performance.now();
  let r, cuerpo = null, err = null;
  try {
    r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(9000),
    });
    cuerpo = await r.json().catch(() => null);
    if (!r.ok) err = cuerpo?.message || `http_${r.status}`;
    else if (cuerpo && typeof cuerpo.error === 'string') err = cuerpo.error;
  } catch (e) { err = 'red:' + (e.name || e.message); }
  (tiempos[nombre] ||= []).push(performance.now() - t0);
  if (err) (errores[nombre] ||= []).push(err);
  return { data: err ? null : cuerpo, error: err };
}
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const { execFileSync } = await import('node:child_process');
const psql = (sql) => execFileSync('psql', [env.DATABASE_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

psql('select prueba_reset()');
console.log(`Registrando ${N} personas…`);
const t0 = performance.now();
const bots = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const r = await rpc('registrar', { p_sede: SEDE, p_nombre: `Carga${i + 1}`, p_apellido: 'Prueba', p_correo: `carga-${Date.now()}-${i}@cecomsa.com`, p_pin: '1234' });
  return r.data?.token;
}));
console.log(`Registro de ${N} a la vez: ${((performance.now() - t0) / 1000).toFixed(1)} s · fallos: ${(errores.registrar || []).length}`);
const f = await rpc('registrar', { p_sede: SEDE, p_nombre: 'Sole', p_apellido: 'Carga', p_correo: `carga-f-${Date.now()}@cecomsa.com`, p_pin: '1234' });
psql(`update personas set es_facilitadora = true where correo like 'carga-f-%'`);
const ftoken = f.data.token;

let fin = Date.now() + DUR;
const vivos = bots.filter(Boolean);
// Sondeos continuos
const sondeos = [];
for (const t of vivos) sondeos.push((async () => { await espera(Math.random() * 3000); while (Date.now() < fin) { await rpc('estado', { p_token: t }); await espera(3000); } })());
sondeos.push((async () => { while (Date.now() < fin) { await rpc('pantalla', { p_sede: SEDE }); await espera(2000); } })());
sondeos.push((async () => { while (Date.now() < fin) { await rpc('f_estado', { p_token: ftoken, p_sede: SEDE }); await espera(3000); } })());

// Escenarios en el peor momento
await espera(10000);
console.log('Abro un quiz: todos responden en 5 s…');
await rpc('f_actividad', { p_token: ftoken, p_sede: SEDE, p_actividad: 'a3', p_estado: 'abierta' });
const t1 = performance.now();
await Promise.all(vivos.map(async (t) => { await espera(Math.random() * 5000); await rpc('responder', { p_token: t, p_actividad: 'a3', p_opcion: Math.floor(Math.random() * 3), p_texto: null }); }));
console.log(`  ${vivos.length} respuestas en ${((performance.now() - t1) / 1000).toFixed(1)} s`);
await rpc('f_actividad', { p_token: ftoken, p_sede: SEDE, p_actividad: 'a3', p_estado: 'resultados' });

await espera(5000);
console.log('Abro el armado de equipos: todos crean o se unen en 10 s…');
await rpc('f_equipos', { p_token: ftoken, p_sede: SEDE, p_estado: 'abierta' });
await Promise.all(vivos.map(async (t, i) => {
  await espera(Math.random() * 10000);
  const st = (await rpc('estado', { p_token: t })).data;
  const libre = st?.equipos?.lista?.find(e => !e.lleno);
  if (libre && i % 4 !== 0) await rpc('unirse_equipo', { p_token: t, p_equipo: libre.id });
  else await rpc('crear_equipo', { p_token: t, p_nombre: `Equipo ${i + 1}` });
}));

await espera(5000);
console.log('Nube de palabras: todos escriben en 5 s…');
await rpc('f_actividad', { p_token: ftoken, p_sede: SEDE, p_actividad: 'a2', p_estado: 'abierta' });
await Promise.all(vivos.map(async (t) => { await espera(Math.random() * 5000); await rpc('responder', { p_token: t, p_actividad: 'a2', p_opcion: null, p_texto: ['reportes', 'correos', 'conciliaciones'][Math.floor(Math.random() * 3)] }); }));
await rpc('f_actividad', { p_token: ftoken, p_sede: SEDE, p_actividad: 'a2', p_estado: 'resultados' });

await Promise.all(sondeos);
psql('select prueba_reset()');

const p = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };
console.log('\nfunción          llamadas   p50    p95    máx   errores');
for (const [k, v] of Object.entries(tiempos).sort((a, b) => b[1].length - a[1].length)) {
  const e = errores[k] || [];
  console.log(`${k.padEnd(16)} ${String(v.length).padStart(8)} ${String(p(v, .5)).padStart(5)}ms ${String(p(v, .95)).padStart(5)}ms ${String(Math.round(Math.max(...v))).padStart(5)}ms  ${e.length}${e.length ? '  (' + [...new Set(e)].join(', ') + ')' : ''}`);
}
const total = Object.values(tiempos).reduce((s, v) => s + v.length, 0);
console.log(`\n${total} llamadas en ${DUR / 1000} s ≈ ${(total / (DUR / 1000)).toFixed(1)} por segundo.`);
