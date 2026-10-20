-- Entregas de las actividades de equipo: hito con foto, texto de equipo y check-in personal.

create or replace function foto_valida(p_foto text) returns boolean
language sql immutable as $$
  select p_foto is not null and length(p_foto) <= 1000000
     and p_foto ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$';
$$;
revoke execute on function foto_valida(text) from public, anon, authenticated;

create or replace function entrega_json(en entregas) returns json
language sql stable set search_path = public as $$
  select json_build_object('id', en.id, 'estado', en.estado, 'motivo', en.motivo);
$$;
revoke execute on function entrega_json(entregas) from public, anon, authenticated;

create or replace function entregar(p_token uuid, p_actividad text, p_texto text, p_texto2 text, p_foto text) returns json
language plpgsql security definer set search_path = public as $$
declare
  p personas := sesion(p_token);
  a actividades;
  en entregas;
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
  v_texto2 text := nullif(trim(coalesce(p_texto2, '')), '');
begin
  select * into a from actividades where id = p_actividad;
  if not found or es_vivo(a.tipo) then raise exception 'actividad_cerrada'; end if;
  if not exists (select 1 from estado_actividad where sede = p.sede and actividad_id = a.id and estado = 'abierta') then
    raise exception 'actividad_cerrada';
  end if;
  if p_foto is not null and not foto_valida(p_foto) then raise exception 'foto_invalida'; end if;

  if a.tipo = 'checkin' then
    if length(coalesce(v_texto, '')) < 10 or length(coalesce(v_texto2, '')) < 10
       or length(v_texto) > 300 or length(v_texto2) > 300 then raise exception 'texto_invalido'; end if;
    -- Personal y editable mientras esté abierto; no necesita aprobación.
    -- Un solo paso: dos envíos simultáneos (doble toque o reintento) no chocan.
    insert into entregas (sede, actividad_id, persona_id, texto, texto2, foto, estado)
      values (p.sede, a.id, p.id, v_texto, v_texto2, p_foto, 'aprobado')
    on conflict (actividad_id, persona_id) where equipo_id is null
      do update set texto = excluded.texto, texto2 = excluded.texto2, foto = coalesce(excluded.foto, entregas.foto),
                    estado = 'aprobado', actualizado = now()
    returning * into en;
    return entrega_json(en);
  end if;

  -- Hito o texto: es del equipo.
  if p.equipo_id is null then raise exception 'sin_equipo'; end if;
  if a.tipo = 'hito' then
    if p_foto is null then raise exception 'foto_invalida'; end if;
    v_texto := left(v_texto, 200);
  elsif length(coalesce(v_texto, '')) < 10 or length(v_texto) > 1000 then
    raise exception 'texto_invalido';
  end if;

  -- Bloquea al equipo: dos miembros subiendo a la vez no crean dos entregas.
  perform 1 from equipos where id = p.equipo_id for update;
  select * into en from entregas where actividad_id = a.id and equipo_id = p.equipo_id;
  if found then
    if en.estado = 'aprobado' then raise exception 'ya_aprobado'; end if;
    update entregas set persona_id = p.id, texto = v_texto, foto = p_foto, estado = 'pendiente', motivo = null, actualizado = now()
      where id = en.id returning * into en;
  else
    insert into entregas (sede, actividad_id, equipo_id, persona_id, texto, foto)
      values (p.sede, a.id, p.equipo_id, p.id, v_texto, p_foto) returning * into en;
  end if;
  return entrega_json(en);
end $$;
grant execute on function entregar(uuid, text, text, text, text) to anon;

-- Lista para el panel: sin la foto (pesa); la foto se pide aparte con f_foto.
create or replace function f_entregas(p_token uuid, p_sede text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform facilitadora(p_token);
  perform exigir_sede(p_sede);
  return coalesce((
    select json_agg(json_build_object(
      'id', en.id, 'actividad_id', en.actividad_id, 'actividad', a.pregunta, 'tipo', a.tipo,
      'equipo', eq.nombre, 'subio', nombre_corto(pe.nombre, pe.apellido),
      'texto', en.texto, 'texto2', en.texto2, 'tiene_foto', en.foto is not null,
      'estado', en.estado, 'motivo', en.motivo, 'actualizado', en.actualizado
    ) order by (en.estado = 'pendiente') desc, en.actualizado desc)
    from entregas en join actividades a on a.id = en.actividad_id
      join personas pe on pe.id = en.persona_id
      left join equipos eq on eq.id = en.equipo_id
    where en.sede = p_sede), '[]'::json);
end $$;

create or replace function f_foto(p_token uuid, p_entrega uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform facilitadora(p_token);
  select foto into v from entregas where id = p_entrega;
  if not found then raise exception 'entrega_no_existe'; end if;
  return json_build_object('foto', v);
end $$;

drop function if exists f_revisar(uuid, uuid, text, text);
-- p_actualizado = la versión que la facilitadora vio. Si el equipo la reemplazó después, no se aprueba a ciegas.
create or replace function f_revisar(p_token uuid, p_entrega uuid, p_estado text, p_motivo text, p_actualizado timestamptz) returns json
language plpgsql security definer set search_path = public as $$
declare en entregas; v_tipo text;
begin
  perform facilitadora(p_token);
  if p_estado not in ('pendiente', 'aprobado', 'rechazado') then raise exception 'estado_invalido'; end if;
  select * into en from entregas where id = p_entrega for update;
  if not found then raise exception 'entrega_no_existe'; end if;
  select tipo into v_tipo from actividades where id = en.actividad_id;
  if v_tipo = 'checkin' then raise exception 'no_revisable'; end if;
  if p_actualizado is null or en.actualizado <> p_actualizado then raise exception 'entrega_cambio'; end if;
  update entregas set estado = p_estado, motivo = case when p_estado = 'rechazado' then left(nullif(trim(coalesce(p_motivo, '')), ''), 200) end
    where id = p_entrega;
  return json_build_object('ok', true);
end $$;

grant execute on function f_entregas(uuid, text) to anon;
grant execute on function f_foto(uuid, uuid) to anon;
grant execute on function f_revisar(uuid, uuid, text, text, timestamptz) to anon;
