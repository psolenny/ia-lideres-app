// Helpers de prueba: hablan con el proyecto Supabase real, siempre en la sede desechable «prueba».
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
export const { SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL } = env;

export async function rpc(nombre, args = {}) {
  if (['santiago', 'sd'].includes(args.p_sede)) throw new Error('prueba_toca_sede_real');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) return { data: null, error: cuerpo?.message || `http_${r.status}` };
  // Algunas funciones devuelven {error} en vez de lanzar (para no deshacer lo que guardan).
  if (cuerpo && typeof cuerpo === 'object' && typeof cuerpo.error === 'string') return { data: null, error: cuerpo.error };
  return { data: cuerpo, error: null };
}

export async function rest(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export function psql(sql) {
  // Las pruebas nunca tocan sedes reales.
  if (/'(santiago|sd)'/.test(sql)) throw new Error('prueba_toca_sede_real');
  try {
    return execFileSync('psql', [DATABASE_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    // No mostrar la cadena de conexión (lleva la contraseña) en los errores.
    throw new Error(`psql: ${String(e.stderr || '').trim()}`);
  }
}

let n = 0;
export function correo() {
  return `t${Date.now()}${++n}@cecomsa.com`;
}

export function resetPrueba() {
  psql('select prueba_reset()');
}

// Registra una persona de prueba y devuelve { token, persona }.
export async function persona(nombre = 'Ana', apellido = 'Prueba', sede = 'prueba') {
  const { data, error } = await rpc('registrar', { p_sede: sede, p_nombre: nombre, p_apellido: apellido, p_correo: correo(), p_pin: '1234' });
  if (error) throw new Error(error);
  return data;
}

export async function facilitadora(sede = 'prueba') {
  const p = await persona('Sole', 'Facilitadora', sede);
  psql(`update personas set es_facilitadora = true where id = '${p.persona.id}'`);
  return p;
}

export function abrir(actividad, sede = 'prueba', segundosAtras = 0) {
  psql(`update estado_actividad set estado = 'cerrada' where sede = '${sede}';
        insert into estado_actividad (sede, actividad_id, estado, abierta_en)
        values ('${sede}', '${actividad}', 'abierta', now() - interval '${segundosAtras} seconds')
        on conflict (sede, actividad_id) do update set estado = 'abierta', abierta_en = excluded.abierta_en`);
}
