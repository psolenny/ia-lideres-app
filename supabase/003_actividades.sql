-- Respuestas y puntos.

-- Quiz acertado: base + bono de rapidez (50 hasta los 20 s, baja en línea recta a 0 a los 60 s).
create or replace function puntos_quiz(p_base int, p_segundos numeric) returns int
language sql immutable as $$
  select p_base + round(50 * greatest(0, least(1, (60 - greatest(p_segundos, 0)) / 40.0)))::int;
$$;
revoke execute on function puntos_quiz(int, numeric) from public, anon, authenticated;

create or replace function respuesta_json(r respuestas, a actividades) returns json
language sql stable as $$
  select json_build_object(
    'opcion', r.opcion, 'texto', r.texto, 'correcta', r.correcta, 'puntos', r.puntos,
    'correcta_idx', case when a.tipo = 'quiz' then a.correcta end,
    'explicacion', case when a.tipo = 'quiz' then a.explicacion end);
$$;
revoke execute on function respuesta_json(respuestas, actividades) from public, anon, authenticated;

create or replace function responder(p_token uuid, p_actividad text, p_opcion int, p_texto text) returns json
language plpgsql security definer set search_path = public as $$
declare
  p personas := sesion(p_token);
  a actividades;
  e estado_actividad;
  r respuestas;
  v_texto text;
  v_correcta boolean;
  v_puntos int;
begin
  select * into a from actividades where id = p_actividad;
  if not found then raise exception 'actividad_cerrada'; end if;

  -- Idempotente: si ya respondió, devuelve lo guardado (reintentos por mala señal).
  select * into r from respuestas where persona_id = p.id and actividad_id = a.id;
  if found then return respuesta_json(r, a); end if;

  select * into e from estado_actividad where sede = p.sede and actividad_id = a.id;
  if not found or e.estado <> 'abierta' then raise exception 'actividad_cerrada'; end if;

  if a.tipo in ('encuesta', 'quiz') then
    if p_opcion is null or p_opcion < 0 or p_opcion >= jsonb_array_length(a.opciones) then raise exception 'opcion_invalida'; end if;
  elsif a.tipo = 'nube' then
    v_texto := lower(regexp_replace(trim(coalesce(p_texto, '')), '\s+', ' ', 'g'));
    if v_texto = '' or length(v_texto) > 40 or array_length(string_to_array(v_texto, ' '), 1) > 4 then raise exception 'texto_invalido'; end if;
  else
    raise exception 'actividad_cerrada';
  end if;

  if a.tipo = 'quiz' then
    v_correcta := (p_opcion = a.correcta);
    v_puntos := case when v_correcta then puntos_quiz(a.puntos, extract(epoch from now() - e.abierta_en)) else 0 end;
  else
    v_puntos := a.puntos;
  end if;

  insert into respuestas (sede, persona_id, actividad_id, opcion, texto, correcta, puntos)
    values (p.sede, p.id, a.id, case when a.tipo = 'nube' then null else p_opcion end, v_texto, v_correcta, v_puntos)
    on conflict (persona_id, actividad_id) do nothing
    returning * into r;
  if r.id is null then
    select * into r from respuestas where persona_id = p.id and actividad_id = a.id;
  end if;
  return respuesta_json(r, a);
end $$;
grant execute on function responder(uuid, text, int, text) to anon;
