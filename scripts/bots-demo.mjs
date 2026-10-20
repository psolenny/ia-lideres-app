// Participantes de prueba para la sede «demo»: se registran y responden solos lo que la facilitadora abra.
// Uso: node scripts/bots-demo.mjs [cantidad=6] [minutos=60]
// Solo funciona en la sede demo. Nunca en santiago ni sd.
import { readFileSync } from 'node:fs';

const SEDE = 'demo';
const CANTIDAD = Number(process.argv[2] || 6);
const MINUTOS = Number(process.argv[3] || 60);
const PIN = '0000';
const NOMBRES = [['Carla', 'Rosario'], ['Miguel', 'Tavárez'], ['Ana', 'Jiménez'], ['Luis', 'Almonte'], ['Rosa', 'Peña'],
  ['Pedro', 'Báez'], ['Yanet', 'Cruz'], ['Jorge', 'Ureña'], ['Paola', 'Santos'], ['Héctor', 'Mejía'], ['Laura', 'Vargas'], ['Raúl', 'Ortiz']];
const PALABRAS = ['reportes semanales', 'correos', 'conciliaciones', 'minutas', 'cotizaciones', 'inventario', 'presentaciones', 'reportes semanales', 'seguimiento', 'correos'];
const EQUIPOS = ['Los Curiosos', 'Equipo Norte', 'Datos Claros', 'Sin Excusas'];

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

async function rpc(nombre, args) {
  if (args.p_sede && args.p_sede !== SEDE) throw new Error('solo_demo');
  let r;
  try {
    r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    return { error: 'red' }; // corte de internet: se reintenta en el siguiente turno
  }
  const c = await r.json().catch(() => null);
  if (!r.ok) return { error: c?.message || r.status };
  if (c && typeof c.error === 'string') return { error: c.error };
  return { data: c };
}

const azar = (n) => Math.floor(Math.random() * n);
const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function entrarBot(i) {
  const [nombre, apellido] = NOMBRES[i % NOMBRES.length];
  const correo = `demo-bot-${i + 1}@cecomsa.com`;
  let r = await rpc('registrar', { p_sede: SEDE, p_nombre: nombre, p_apellido: apellido, p_correo: correo, p_pin: PIN });
  if (r.error === 'ya_registrado') r = await rpc('entrar', { p_sede: SEDE, p_correo: correo, p_pin: PIN });
  if (r.error) throw new Error(`${nombre}: ${r.error}`);
  return { nombre, token: r.data.token, nivel: azar(4), ocupado: false, sinEquipo: i === CANTIDAD - 1 };
}

async function turno(bot) {
  if (bot.ocupado) return;
  const { data: st, error } = await rpc('estado', { p_token: bot.token });
  if (error || !st) return;
  const a = st.actividad;
  if (!a || a.estado !== 'abierta') return;
  if (a.tipo === 'equipos') {
    // El último bot se queda sin equipo para que la facilitadora pruebe «mover».
    if (st.yo.equipo || bot.sinEquipo || !st.equipos || st.equipos.estado !== 'abierta') return;
    bot.ocupado = true;
    await espera(2000 + azar(8000));
    const libre = st.equipos.lista.find(e => !e.lleno && e.miembros.length < 3);
    if (libre) await rpc('unirse_equipo', { p_token: bot.token, p_equipo: libre.id });
    else await rpc('crear_equipo', { p_token: bot.token, p_nombre: EQUIPOS.find(n => !st.equipos.lista.some(e => e.nombre === n)) || `Equipo ${azar(99)}` });
    bot.ocupado = false;
    return;
  }
  if (a.mi_respuesta) return;
  bot.ocupado = true;
  await espera(2000 + azar(13000));
  let r;
  if (a.tipo === 'nube') r = await rpc('responder', { p_token: bot.token, p_actividad: a.id, p_opcion: null, p_texto: PALABRAS[azar(PALABRAS.length)] });
  else if (a.id === 'a1') r = await rpc('responder', { p_token: bot.token, p_actividad: a.id, p_opcion: bot.nivel, p_texto: null });
  else r = await rpc('responder', { p_token: bot.token, p_actividad: a.id, p_opcion: azar(a.opciones.length), p_texto: null });
  if (!r.error) console.log(`${bot.nombre} respondió ${a.id}${r.data.correcta === true ? ' ✓' : r.data.correcta === false ? ' ✗' : ''}`);
  bot.ocupado = false;
}

const bots = [];
for (let i = 0; i < CANTIDAD; i++) bots.push(await entrarBot(i));
console.log(`${bots.length} participantes de prueba en «demo»: ${bots.map(b => b.nombre).join(', ')}. Activos ${MINUTOS} min.`);
const fin = Date.now() + MINUTOS * 60000;
while (Date.now() < fin) {
  // Un turno fallido nunca detiene a los demás: se libera el bot y se reintenta en 3 s.
  bots.forEach(b => turno(b).catch(e => { b.ocupado = false; console.log(`${b.nombre}: ${e.message}`); }));
  await espera(3000);
}
console.log('Fin de los participantes de prueba.');
