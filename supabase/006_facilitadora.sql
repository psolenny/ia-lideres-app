-- Funciones del panel de la facilitadora. Todas validan es_facilitadora; puede operar cualquier sede.

create or replace function facilitadora(p_token uuid) returns personas
language plpgsql security definer set search_path = public as $$
declare p personas := sesion(p_token);
begin
  if not p.es_facilitadora then raise exception 'no_autorizado'; end if;
  return p;
end $$;
revoke execute on function facilitadora(uuid) from public, anon, authenticated;

create or replace function exigir_sede(p_sede text) returns void
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from sedes where id = p_sede) then raise exception 'sede_invalida'; end if;
end $$;
revoke execute on function exigir_sede(text) from public, anon, authenticated;

create or replace function f_estado(p_token uuid, p_sede text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform facilitadora(p_token);
  perform exigir_sede(p_sede);
  return json_build_object(
    'sede', (select nombre from sedes where id = p_sede),
    'equipos_estado', (select equipos_estado from sedes where id = p_sede),
    'actividades', (select json_agg(json_build_object(
        'id', a.id, 'dia', a.dia, 'orden', a.orden, 'tipo', a.tipo, 'lamina', a.lamina, 'pregunta', a.pregunta,
        'estado', coalesce(ea.estado, 'cerrada'),
        'respuestas', (select count(*) from respuestas r where r.sede = p_sede and r.actividad_id = a.id)
      ) order by a.dia, a.orden)
      from actividades a left join estado_actividad ea on ea.actividad_id = a.id and ea.sede = p_sede),
    'personas', coalesce((select json_agg(json_build_object(
        'id', pe.id, 'nombre', pe.nombre, 'apellido', pe.apellido, 'correo', pe.correo,
        'es_facilitadora', pe.es_facilitadora, 'equipo_id', pe.equipo_id, 'bloqueado', pe.bloqueado_hasta > now(),
        'nivel', (select r.opcion from respuestas r where r.persona_id = pe.id and r.actividad_id = 'a1'),
        'puntos', (select coalesce(sum(r.puntos), 0) from respuestas r where r.persona_id = pe.id)
      ) order by pe.nombre, pe.apellido) from personas pe where pe.sede = p_sede), '[]'::json),
    'equipos', coalesce((select json_agg(json_build_object(
        'id', e.id, 'nombre', e.nombre, 'cupo_max', e.cupo_max, 'excepcion', e.excepcion
      ) order by e.creado) from equipos e where e.sede = p_sede), '[]'::json));
end $$;

create or replace function f_actividad(p_token uuid, p_sede text, p_actividad text, p_estado text) returns json
language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  perform facilitadora(p_token);
  perform exigir_sede(p_sede);
  if p_estado not in ('cerrada', 'abierta', 'resultados') then raise exception 'estado_invalido'; end if;
  select tipo into v_tipo from actividades where id = p_actividad;
  if not found then raise exception 'actividad_no_existe'; end if;

  -- Bloquea la sede: dos toques seguidos no pueden dejar dos actividades vivas.
  perform 1 from sedes where id = p_sede for update;
  if p_estado <> 'cerrada' then
    -- Solo una actividad no cerrada por sede.
    update estado_actividad set estado = 'cerrada', cambiado_en = now()
      where sede = p_sede and actividad_id <> p_actividad and estado <> 'cerrada';
    -- Si la que se cierra era la de equipos, el armado queda en final.
    if exists (select 1 from sedes where id = p_sede and equipos_estado = 'abierta') and v_tipo <> 'equipos' then
      update sedes set equipos_estado = 'final' where id = p_sede;
    end if;
  end if;

  insert into estado_actividad (sede, actividad_id, estado, abierta_en, cambiado_en)
    values (p_sede, p_actividad, p_estado, case when p_estado = 'abierta' then now() end, now())
  on conflict (sede, actividad_id) do update set estado = excluded.estado, cambiado_en = now(),
    abierta_en = case when excluded.estado = 'abierta' then now() else estado_actividad.abierta_en end;

  if v_tipo = 'equipos' then
    update sedes set equipos_estado = case when p_estado = 'abierta' then 'abierta' else 'final' end where id = p_sede;
  end if;
  return json_build_object('ok', true);
end $$;

-- Abrir o cerrar el armado mueve también la actividad de equipos, para que celulares y pantalla lo muestren.
create or replace function f_equipos(p_token uuid, p_sede text, p_estado text) returns json
language plpgsql security definer set search_path = public as $$
declare v_act text;
begin
  perform facilitadora(p_token);
  perform exigir_sede(p_sede);
  if p_estado not in ('cerrada', 'abierta', 'final') then raise exception 'estado_invalido'; end if;
  select id into v_act from actividades where tipo = 'equipos' order by dia, orden limit 1;
  if p_estado = 'abierta' and v_act is not null then
    return f_actividad(p_token, p_sede, v_act, 'abierta');
  end if;
  update estado_actividad set estado = 'cerrada', cambiado_en = now()
    where sede = p_sede and actividad_id = v_act and estado <> 'cerrada';
  update sedes set equipos_estado = p_estado where id = p_sede;
  return json_build_object('ok', true);
end $$;

create or replace function f_mover(p_token uuid, p_persona uuid, p_equipo uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_anterior uuid; v_sede text;
begin
  perform facilitadora(p_token);
  select equipo_id, sede into v_anterior, v_sede from personas where id = p_persona;
  if not found then raise exception 'persona_no_existe'; end if;
  if p_equipo is not null and not exists (select 1 from equipos where id = p_equipo and sede = v_sede) then
    raise exception 'equipo_no_existe';
  end if;
  update personas set equipo_id = p_equipo where id = p_persona;
  return json_build_object('ok', true);
end $$;

create or replace function f_excepcion(p_token uuid, p_equipo uuid, p_activa boolean) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform facilitadora(p_token);
  update equipos set excepcion = p_activa, cupo_max = case when p_activa then 5 else 4 end where id = p_equipo;
  if not found then raise exception 'equipo_no_existe'; end if;
  return json_build_object('ok', true);
end $$;

create or replace function f_crear_equipo(p_token uuid, p_sede text, p_nombre text) returns json
language plpgsql security definer set search_path = public as $$
declare v_nombre text := trim(coalesce(p_nombre, '')); e equipos;
begin
  perform facilitadora(p_token);
  perform exigir_sede(p_sede);
  if length(v_nombre) < 1 or length(v_nombre) > 30 then raise exception 'nombre_invalido'; end if;
  insert into equipos (sede, nombre) values (p_sede, v_nombre) returning * into e;
  return json_build_object('id', e.id, 'nombre', e.nombre);
exception when unique_violation then raise exception 'nombre_repetido';
end $$;

create or replace function f_reset_pin(p_token uuid, p_persona uuid, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform facilitadora(p_token);
  -- Participantes: PIN de 4 números. Facilitadora: clave de al menos 8 caracteres.
  if exists (select 1 from personas where id = p_persona and es_facilitadora) then
    if length(coalesce(p_pin, '')) < 8 then raise exception 'pin_invalido'; end if;
  elsif coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'pin_invalido'; end if;
  update personas set pin_hash = crypt(p_pin, gen_salt('bf')), intentos = 0, bloqueado_hasta = null where id = p_persona;
  if not found then raise exception 'persona_no_existe'; end if;
  return json_build_object('ok', true);
end $$;

create or replace function f_registrar(p_token uuid, p_sede text, p_nombre text, p_apellido text, p_correo text, p_pin text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform facilitadora(p_token);
  return crear_persona(p_sede, p_nombre, p_apellido, p_correo, p_pin);
end $$;

create or replace function f_borrar_persona(p_token uuid, p_persona uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_equipo uuid;
begin
  perform facilitadora(p_token);
  delete from personas where id = p_persona and not es_facilitadora returning equipo_id into v_equipo;
  if not found then raise exception 'persona_no_existe'; end if;
  return json_build_object('ok', true);
end $$;

grant execute on function f_estado(uuid, text) to anon;
grant execute on function f_actividad(uuid, text, text, text) to anon;
grant execute on function f_equipos(uuid, text, text) to anon;
grant execute on function f_mover(uuid, uuid, uuid) to anon;
grant execute on function f_excepcion(uuid, uuid, boolean) to anon;
grant execute on function f_crear_equipo(uuid, text, text) to anon;
grant execute on function f_reset_pin(uuid, uuid, text) to anon;
grant execute on function f_registrar(uuid, text, text, text, text, text) to anon;
grant execute on function f_borrar_persona(uuid, uuid) to anon;
