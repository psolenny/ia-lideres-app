-- Esquema de la plataforma del workshop «IA para líderes».
-- Todas las tablas tienen RLS activado y ninguna política: anon no lee ni escribe nada directo.
-- Todo pasa por funciones security definer (archivos 002 en adelante).

create extension if not exists pgcrypto with schema extensions;

create table if not exists sedes (
  id text primary key,
  nombre text not null,
  equipos_estado text not null default 'cerrada' check (equipos_estado in ('cerrada', 'abierta', 'final'))
);

create table if not exists equipos (
  id uuid primary key default gen_random_uuid(),
  sede text not null references sedes(id),
  nombre text not null,
  cupo_max int not null default 4,
  excepcion boolean not null default false,
  creado timestamptz not null default now()
);
create unique index if not exists equipos_nombre_sede on equipos (sede, lower(nombre));

create table if not exists personas (
  id uuid primary key default gen_random_uuid(),
  sede text not null references sedes(id),
  nombre text not null,
  apellido text not null,
  correo text not null,
  pin_hash text not null,
  es_facilitadora boolean not null default false,
  equipo_id uuid references equipos(id) on delete set null,
  intentos int not null default 0,
  bloqueado_hasta timestamptz,
  creado timestamptz not null default now(),
  unique (sede, correo)
);
create index if not exists personas_equipo on personas (equipo_id);

create table if not exists sesiones (
  token uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas(id) on delete cascade,
  creado timestamptz not null default now()
);

create table if not exists actividades (
  id text primary key,
  dia int not null,
  orden numeric not null,
  tipo text not null check (tipo in ('encuesta', 'nube', 'quiz', 'equipos')),
  lamina text,
  pregunta text not null,
  opciones jsonb,
  correcta int,
  explicacion text,
  puntos int not null default 0
);

create table if not exists estado_actividad (
  sede text not null references sedes(id),
  actividad_id text not null references actividades(id) on delete cascade,
  estado text not null default 'cerrada' check (estado in ('cerrada', 'abierta', 'resultados')),
  abierta_en timestamptz,
  primary key (sede, actividad_id)
);
-- Momento del último cambio de estado: la actividad cambiada más reciente es la que se muestra.
alter table estado_actividad add column if not exists cambiado_en timestamptz;

create table if not exists respuestas (
  id bigserial primary key,
  sede text not null references sedes(id),
  persona_id uuid not null references personas(id) on delete cascade,
  actividad_id text not null references actividades(id) on delete cascade,
  opcion int,
  texto text,
  correcta boolean,
  puntos int not null default 0,
  creado timestamptz not null default now(),
  unique (persona_id, actividad_id)
);
create index if not exists respuestas_actividad on respuestas (sede, actividad_id);

-- Fase 2: actividades de equipo (hito con foto, texto de equipo, check-in personal).
alter table actividades drop constraint if exists actividades_tipo_check;
alter table actividades add constraint actividades_tipo_check
  check (tipo in ('encuesta', 'nube', 'quiz', 'equipos', 'hito', 'texto', 'checkin'));

create table if not exists entregas (
  id uuid primary key default gen_random_uuid(),
  sede text not null references sedes(id),
  actividad_id text not null references actividades(id) on delete cascade,
  equipo_id uuid references equipos(id) on delete cascade,      -- null en el check-in (es personal)
  persona_id uuid not null references personas(id) on delete cascade,  -- quién la subió
  texto text,
  texto2 text,
  foto text,                                                    -- data URL JPEG reducida en el celular
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  motivo text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create unique index if not exists entregas_por_equipo on entregas (actividad_id, equipo_id) where equipo_id is not null;
create unique index if not exists entregas_por_persona on entregas (actividad_id, persona_id) where equipo_id is null;
create index if not exists entregas_sede on entregas (sede, estado);
alter table entregas enable row level security;

alter table sedes enable row level security;
alter table equipos enable row level security;
alter table personas enable row level security;
alter table sesiones enable row level security;
alter table actividades enable row level security;
alter table estado_actividad enable row level security;
alter table respuestas enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Que las tablas futuras tampoco queden expuestas por defecto.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- En vivo = una a la vez en «Ahora». Las demás (hito, texto, checkin) viven en «Mi equipo».
create or replace function es_vivo(p_tipo text) returns boolean
language sql immutable as $$ select p_tipo in ('encuesta', 'nube', 'quiz', 'equipos') $$;
revoke execute on function es_vivo(text) from public, anon, authenticated;
