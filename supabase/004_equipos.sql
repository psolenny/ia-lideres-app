-- Armado de equipos en vivo. Cupo controlado con bloqueo de fila para que dos personas no tomen el mismo lugar.

create or replace function exigir_equipos_abiertos(p_sede text) returns void
language plpgsql set search_path = public as $$
begin
  if (select equipos_estado from sedes where id = p_sede) <> 'abierta' then raise exception 'equipos_cerrado'; end if;
end $$;
revoke execute on function exigir_equipos_abiertos(text) from public, anon, authenticated;

create or replace function crear_equipo(p_token uuid, p_nombre text) returns json
language plpgsql security definer set search_path = public as $$
declare p personas := sesion(p_token); v_nombre text := trim(coalesce(p_nombre, '')); e equipos;
begin
  perform exigir_equipos_abiertos(p.sede);
  if p.equipo_id is not null then raise exception 'ya_tienes_equipo'; end if;
  if length(v_nombre) < 1 or length(v_nombre) > 30 then raise exception 'nombre_invalido'; end if;
  begin
    insert into equipos (sede, nombre) values (p.sede, v_nombre) returning * into e;
  exception when unique_violation then raise exception 'nombre_repetido';
  end;
  update personas set equipo_id = e.id where id = p.id;
  return json_build_object('id', e.id, 'nombre', e.nombre);
end $$;

create or replace function unirse_equipo(p_token uuid, p_equipo uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p personas := sesion(p_token); e equipos; v_n int;
begin
  perform exigir_equipos_abiertos(p.sede);
  -- Bloquea la fila del equipo: la segunda persona espera y luego ve el cupo real.
  select * into e from equipos where id = p_equipo and sede = p.sede for update;
  if not found then raise exception 'equipo_no_existe'; end if;
  select * into p from personas where id = p.id for update;
  if p.equipo_id is not null then raise exception 'ya_tienes_equipo'; end if;
  select count(*) into v_n from personas where equipo_id = e.id;
  if v_n >= e.cupo_max then raise exception 'equipo_lleno'; end if;
  update personas set equipo_id = e.id where id = p.id;
  return json_build_object('id', e.id, 'nombre', e.nombre, 'miembros', v_n + 1);
end $$;

create or replace function salir_equipo(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p personas := sesion(p_token);
begin
  perform exigir_equipos_abiertos(p.sede);
  if p.equipo_id is null then return json_build_object('ok', true); end if;
  perform 1 from equipos where id = p.equipo_id for update;
  update personas set equipo_id = null where id = p.id;
  delete from equipos e where e.id = p.equipo_id and not exists (select 1 from personas where equipo_id = e.id);
  return json_build_object('ok', true);
end $$;

grant execute on function crear_equipo(uuid, text) to anon;
grant execute on function unirse_equipo(uuid, uuid) to anon;
grant execute on function salir_equipo(uuid) to anon;
