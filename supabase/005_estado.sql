-- Lo que ve el participante (estado) y lo que se proyecta (pantalla).

create or replace function nombre_corto(p_nombre text, p_apellido text) returns text
language sql immutable as $$
  select trim(p_nombre) || ' ' || upper(left(trim(p_apellido), 1)) || '.';
$$;
grant execute on function nombre_corto(text, text) to anon;

-- Puntos por persona de una sede (sin facilitadoras).
create or replace function puntos_personas(p_sede text)
returns table (id uuid, nombre text, equipo_id uuid, puntos int)
language sql stable set search_path = public as $$
  select pe.id, nombre_corto(pe.nombre, pe.apellido), pe.equipo_id,
    (coalesce((select sum(r.puntos) from respuestas r where r.persona_id = pe.id), 0)
     -- check-in entregado (personal)
     + coalesce((select sum(a.puntos) from entregas en join actividades a on a.id = en.actividad_id
                 where en.persona_id = pe.id and en.equipo_id is null and en.estado = 'aprobado'), 0))::int
  from personas pe
  where pe.sede = p_sede and not pe.es_facilitadora;
$$;
revoke execute on function puntos_personas(text) from public, anon, authenticated;

-- Puntos que gana el equipo como tal: hitos (con bono de colaboración), textos de equipo y bono de check-in.
create or replace function puntos_de_equipo(p_equipo uuid) returns int
language sql stable set search_path = public as $$
  with aprobadas as (
    select en.persona_id, a.tipo, a.puntos from entregas en join actividades a on a.id = en.actividad_id
    where en.equipo_id = p_equipo and en.estado = 'aprobado'),
  miembros as (select id from personas where equipo_id = p_equipo and not es_facilitadora)
  select (
    -- Hitos: 100 % si los subieron al menos 2 personas distintas; 60 % si los subió una sola.
    coalesce((select sum(puntos) from aprobadas where tipo = 'hito'), 0)
      * (case when (select count(distinct persona_id) from aprobadas where tipo = 'hito') >= 2 then 1.0 else 0.6 end)
    + coalesce((select sum(puntos) from aprobadas where tipo = 'texto'), 0)
    -- Bono de 100 por cada check-in que entregaron todos los miembros.
    + 100 * (select count(*) from actividades a where a.tipo = 'checkin'
             and exists (select 1 from miembros)
             and not exists (select 1 from miembros m where not exists (
               select 1 from entregas en where en.actividad_id = a.id and en.persona_id = m.id
                 and en.equipo_id is null and en.estado = 'aprobado')))
  )::int;
$$;
revoke execute on function puntos_de_equipo(uuid) from public, anon, authenticated;

-- Equipos con puntaje = promedio de sus miembros + puntos de equipo.
create or replace function puntos_equipos(p_sede text)
returns table (id uuid, nombre text, puntos int, miembros int)
language sql stable set search_path = public as $$
  select e.id, e.nombre, (coalesce(round(avg(pp.puntos)), 0) + puntos_de_equipo(e.id))::int, count(pp.id)::int
  from equipos e left join puntos_personas(p_sede) pp on pp.equipo_id = e.id
  where e.sede = p_sede
  group by e.id;
$$;
revoke execute on function puntos_equipos(text) from public, anon, authenticated;

create or replace function lista_equipos(p_sede text) returns json
language sql stable set search_path = public as $$
  select json_build_object(
    'estado', (select equipos_estado from sedes where id = p_sede),
    'lista', coalesce((
      select json_agg(json_build_object(
        'id', e.id, 'nombre', e.nombre, 'cupo_max', e.cupo_max, 'excepcion', e.excepcion,
        'miembros', coalesce((select json_agg(nombre_corto(pe.nombre, pe.apellido) order by pe.nombre)
                              from personas pe where pe.equipo_id = e.id), '[]'::json),
        'lleno', (select count(*) from personas pe where pe.equipo_id = e.id) >= e.cupo_max
      ) order by e.creado)
      from equipos e where e.sede = p_sede), '[]'::json),
    'sin_equipo', coalesce((
      select json_agg(nombre_corto(pe.nombre, pe.apellido) order by pe.nombre)
      from personas pe where pe.sede = p_sede and pe.equipo_id is null and not pe.es_facilitadora), '[]'::json));
$$;
revoke execute on function lista_equipos(text) from public, anon, authenticated;

create or replace function estado(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  p personas := sesion(p_token);
  a actividades; e estado_actividad; r respuestas;
  v_actividad json; v_equipo json; v_puntos int;
begin
  -- Mismo cálculo que el ranking (respuestas + check-in).
  v_puntos := coalesce((select sum(rr.puntos) from respuestas rr where rr.persona_id = p.id), 0)
    + coalesce((select sum(a2.puntos) from entregas en join actividades a2 on a2.id = en.actividad_id
                where en.persona_id = p.id and en.equipo_id is null and en.estado = 'aprobado'), 0);

  if p.equipo_id is not null then
    select json_build_object('id', eq.id, 'nombre', eq.nombre,
      'miembros', (select json_agg(nombre_corto(x.nombre, x.apellido) order by x.nombre) from personas x where x.equipo_id = eq.id))
      into v_equipo from equipos eq where eq.id = p.equipo_id;
  end if;

  select ea.* into e from estado_actividad ea join actividades ac on ac.id = ea.actividad_id
    where ea.sede = p.sede and ea.estado <> 'cerrada' and es_vivo(ac.tipo) order by ea.cambiado_en desc nulls last, ea.abierta_en desc nulls last limit 1;
  if found then
    select * into a from actividades where id = e.actividad_id;
    select * into r from respuestas where persona_id = p.id and actividad_id = a.id;
    v_actividad := json_build_object('id', a.id, 'tipo', a.tipo, 'pregunta', a.pregunta, 'opciones', a.opciones,
      'estado', e.estado, 'mi_respuesta', case when r.id is null then null else respuesta_json(r, a) end);
  end if;

  return json_build_object(
    'yo', json_build_object('nombre', p.nombre, 'apellido', p.apellido, 'puntos', v_puntos,
                            'equipo', v_equipo, 'es_facilitadora', p.es_facilitadora, 'sede', p.sede),
    'actividad', v_actividad,
    -- Actividades de equipo abiertas, con lo que ya entregó mi equipo (o yo, en el check-in).
    'tareas', coalesce((
      select json_agg(json_build_object('id', act.id, 'tipo', act.tipo, 'pregunta', act.pregunta, 'puntos', act.puntos,
        'entrega', (select json_build_object('id', en.id, 'estado', en.estado, 'motivo', en.motivo, 'texto', en.texto,
                      'texto2', en.texto2, 'tiene_foto', en.foto is not null,
                      'subio', (select nombre_corto(x.nombre, x.apellido) from personas x where x.id = en.persona_id))
                    from entregas en where en.actividad_id = act.id and
                      ((act.tipo = 'checkin' and en.persona_id = p.id and en.equipo_id is null)
                       or (act.tipo <> 'checkin' and en.equipo_id = p.equipo_id)))
      ) order by act.dia, act.orden)
      from actividades act join estado_actividad ea on ea.actividad_id = act.id and ea.sede = p.sede
      where not es_vivo(act.tipo) and ea.estado = 'abierta'), '[]'::json),
    'equipos', case when (select equipos_estado from sedes where id = p.sede) <> 'cerrada' then lista_equipos(p.sede) end,
    'ranking', json_build_object(
      'personas', coalesce((
        select json_agg(json_build_object('nombre', t.nombre, 'puntos', t.puntos, 'puesto', t.puesto, 'yo', t.id = p.id) order by t.puesto, t.nombre)
        from (select pp.*, rank() over (order by pp.puntos desc)::int as puesto from puntos_personas(p.sede) pp) t
        where t.puesto <= 10 or t.id = p.id), '[]'::json),
      'equipos', coalesce((
        select json_agg(json_build_object('nombre', t.nombre, 'puntos', t.puntos, 'puesto', t.puesto, 'yo', t.id = p.equipo_id) order by t.puesto, t.nombre)
        from (select pe.*, rank() over (order by pe.puntos desc)::int as puesto from puntos_equipos(p.sede) pe) t), '[]'::json)));
end $$;
grant execute on function estado(uuid) to anon;

-- Pantalla proyectada: sin token, sin correos.
create or replace function pantalla(p_sede text) returns json
language plpgsql security definer set search_path = public as $$
declare a actividades; e estado_actividad; v_res json; v_n int;
begin
  if not exists (select 1 from sedes where id = p_sede) then raise exception 'sede_invalida'; end if;

  select ea.* into e from estado_actividad ea
    where ea.sede = p_sede and ea.estado <> 'cerrada'
      and es_vivo((select tipo from actividades where id = ea.actividad_id)) order by ea.cambiado_en desc nulls last, ea.abierta_en desc nulls last limit 1;
  if found then
    select * into a from actividades where id = e.actividad_id;
    select count(*) into v_n from respuestas where sede = p_sede and actividad_id = a.id;
    if e.estado = 'resultados' and a.tipo in ('encuesta', 'quiz') then
      v_res := json_build_object('respondieron', v_n,
        'conteo', (select json_agg((select count(*) from respuestas r where r.sede = p_sede and r.actividad_id = a.id and r.opcion = i)::int order by i)
                   from generate_series(0, jsonb_array_length(a.opciones) - 1) i),
        'primeros', case when a.tipo = 'quiz' then coalesce((
            select json_agg(t.n order by t.creado) from (
              select nombre_corto(pe.nombre, pe.apellido) n, r.creado from respuestas r join personas pe on pe.id = r.persona_id
              where r.sede = p_sede and r.actividad_id = a.id and r.correcta and not pe.es_facilitadora
              order by r.creado limit 5) t), '[]'::json) end);
    elsif e.estado = 'resultados' and a.tipo = 'nube' then
      v_res := json_build_object('respondieron', v_n,
        'palabras', coalesce((select json_agg(json_build_object('texto', t.texto, 'n', t.n) order by t.n desc, t.texto)
                              from (select texto, count(*)::int n from respuestas where sede = p_sede and actividad_id = a.id
                                    group by texto order by count(*) desc, texto limit 40) t), '[]'::json));
    else
      v_res := json_build_object('respondieron', v_n);
    end if;
  end if;

  return json_build_object(
    'sede', (select nombre from sedes where id = p_sede),
    'actividad', case when a.id is null then null else json_build_object('id', a.id, 'tipo', a.tipo, 'pregunta', a.pregunta,
      'opciones', a.opciones, 'estado', e.estado,
      'correcta', case when e.estado = 'resultados' and a.tipo = 'quiz' then a.correcta end) end,
    'resultados', v_res,
    'equipos', case when (select equipos_estado from sedes where id = p_sede) <> 'cerrada' then lista_equipos(p_sede) end,
    'ranking', json_build_object(
      'personas', coalesce((select json_agg(json_build_object('nombre', t.nombre, 'puntos', t.puntos, 'puesto', t.puesto) order by t.puesto, t.nombre)
        from (select pp.*, rank() over (order by pp.puntos desc)::int puesto from puntos_personas(p_sede) pp) t where t.puesto <= 10), '[]'::json),
      'equipos', coalesce((select json_agg(json_build_object('nombre', t.nombre, 'puntos', t.puntos, 'puesto', t.puesto) order by t.puesto, t.nombre)
        from (select pe.*, rank() over (order by pe.puntos desc)::int puesto from puntos_equipos(p_sede) pe) t), '[]'::json)));
end $$;
grant execute on function pantalla(text) to anon;
