// Participantes de prueba para la sede «demo»: se registran y responden solos lo que la facilitadora abra.
// Uso: node scripts/bots-demo.mjs [cantidad=6] [minutos=60]
// Solo funciona en la sede demo. Nunca en santiago ni sd.
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

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

// PNG de un color (320×200) como data URL: sirve de «foto» de prueba.
function fotoDePrueba() {
  const [r, g, b] = [[0, 47, 108], [227, 28, 121], [162, 0, 103]][azar(3)];
  const w = 320, hgt = 200, fila = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) fila.set([r, g, b], 1 + x * 3);
  const crudo = Buffer.concat(Array.from({ length: hgt }, () => fila));
  const crc = (buf) => { let c = ~0; for (const v of buf) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const bloque = (tipo, datos) => { const t = Buffer.from(tipo); const l = Buffer.alloc(4); l.writeUInt32BE(datos.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, datos]))); return Buffer.concat([l, t, datos, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloque('IHDR', ihdr), bloque('IDAT', deflateSync(crudo)), bloque('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
const USOS = ['Resumí el informe mensual de ventas en cinco puntos', 'Preparé la agenda de la reunión de equipo', 'Redacté el borrador de una política interna',
  'Comparé dos cotizaciones de proveedores sin datos sensibles', 'Armé el guion de la capacitación del lunes', 'Ordené las ideas para el plan del trimestre'];
const TEXTOS = { t1: 'Actúa como analista de operaciones. Con estas notas, arma un resumen de 5 puntos y una lista de pendientes con responsable.',
  t2: 'La IA inventó una cifra de ventas que no estaba en el archivo. Lo vimos al comparar con el reporte original y le pedimos citar la fila.' };
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
  // Entregas de «Mi equipo»: cada bot tiene 1 de 4 chances por turno de encargarse de una pendiente.
  for (const t of st.tareas || []) {
    if (t.entrega && t.entrega.estado !== 'rechazado') continue;
    if (t.tipo !== 'checkin' && (!st.yo.equipo || azar(4) !== 0)) continue;
    bot.ocupado = true;
    await espera(3000 + azar(12000));
    const r = t.tipo === 'hito' ? await rpc('entregar', { p_token: bot.token, p_actividad: t.id, p_texto: 'Foto de prueba', p_texto2: null, p_foto: fotoDePrueba() })
      : t.tipo === 'texto' ? await rpc('entregar', { p_token: bot.token, p_actividad: t.id, p_texto: TEXTOS[t.id] || 'Texto de prueba del equipo para revisar.', p_texto2: null, p_foto: null })
      : await rpc('entregar', { p_token: bot.token, p_actividad: t.id, p_texto: USOS[azar(USOS.length)], p_texto2: USOS[azar(USOS.length)], p_foto: null });
    if (!r.error) console.log(`${bot.nombre} entregó ${t.id}`);
    bot.ocupado = false;
    return;
  }
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
