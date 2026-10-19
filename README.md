# IA para líderes · Reto en vivo

Plataforma del workshop «IA para líderes» (CECOMSA): encuestas, nube de palabras, quiz y armado de equipos en vivo desde el celular, con marcador y una pantalla para proyectar.

| Página | Para quién | URL |
|---|---|---|
| `index.html?sede=santiago` / `?sede=sd` | participantes (celular) | por QR |
| `pantalla.html?sede=…` | proyector (sin datos personales; tecla **M** = marcador) | |
| `panel.html?sede=…` | facilitadora | |

## Cómo funciona

- Páginas estáticas (HTML/CSS/JS, sin compilación) en GitHub Pages.
- Datos en Supabase. Las tablas no se leen directo: todo pasa por funciones del servidor (`supabase/*.sql`) que validan la sesión.
- `js/config.js` lleva la URL y la llave pública (`anon`) de Supabase; es pública por diseño.
- Las pantallas se actualizan cada 2–3 s.

## Base de datos

Aplicar en orden con `psql` (la cadena de conexión va en `.env.local`, que no se sube):

```
001_esquema.sql  002_acceso.sql  003_actividades.sql  004_equipos.sql
005_estado.sql   006_facilitadora.sql  seed.sql  prueba.sql
```

Todos se pueden volver a ejecutar. `seed.sql` contiene las actividades del Día 1 (borrador pendiente de aprobación de la facilitadora).

## Pruebas

```
npm test
```

Corren contra el proyecto real, solo en las sedes desechables `prueba` y `prueba2`; una guardia impide que toquen Santiago o Santo Domingo. `.env.local` necesita `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `DATABASE_URL`.
