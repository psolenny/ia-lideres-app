-- Puntos adicionales que la facilitadora otorga a mano, a una persona o a un equipo.

create table if not exists bonos (
  id uuid primary key default gen_random_uuid(),
  sede text not null references sedes(id),
  persona_id uuid references personas(id) on delete cascade,
  equipo_id uuid references equipos(id) on delete cascade,
  puntos int not null,
  motivo text not null,
  otorgado_por uuid references personas(id) on delete set null,
  creado timestamptz not null default now(),
  check ((persona_id is null) <> (equipo_id is null))
);
create index if not exists bonos_sede on bonos (sede, creado desc);
alter table bonos enable row level security;
revoke all on bonos from anon, authenticated;

create or replace function bonos_persona(p_persona uuid) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(puntos), 0)::int from bonos where persona_id = p_persona;
$$;
revoke execute on function bonos_persona(uuid) from public, anon, authenticated;

create or replace function bonos_equipo(p_equipo uuid) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(puntos), 0)::int from bonos where equipo_id = p_equipo;
$$;
revoke execute on function bonos_equipo(uuid) from public, anon, authenticated;

create or replace function f_bono(p_token uuid, p_persona uuid, p_equipo uuid, p_puntos int, p_motivo text) returns json
language plpgsql security definer set search_path = public as $$
declare f personas := facilitadora(p_token); v_sede text; b bonos; v_motivo text := trim(coalesce(p_motivo, ''));
begin
  if (p_persona is null) = (p_equipo is null) then raise exception 'destino_invalido'; end if;
  if p_puntos is null or p_puntos = 0 or abs(p_puntos) > 1000 then raise exception 'puntos_invalidos'; end if;
  if length(v_motivo) < 3 or length(v_motivo) > 80 then raise exception 'motivo_invalido'; end if;
  if p_persona is not null then
    select sede into v_sede from personas where id = p_persona;
    if not found then raise exception 'persona_no_existe'; end if;
  else
    select sede into v_sede from equipos where id = p_equipo;
    if not found then raise exception 'equipo_no_existe'; end if;
  end if;
  insert into bonos (sede, persona_id, equipo_id, puntos, motivo, otorgado_por)
    values (v_sede, p_persona, p_equipo, p_puntos, v_motivo, f.id) returning * into b;
  return json_build_object('id', b.id, 'puntos', b.puntos);
end $$;

create or replace function f_quitar_bono(p_token uuid, p_bono uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform facilitadora(p_token);
  delete from bonos where id = p_bono;
  if not found then raise exception 'bono_no_existe'; end if;
  return json_build_object('ok', true);
end $$;

grant execute on function f_bono(uuid, uuid, uuid, int, text) to anon;
grant execute on function f_quitar_bono(uuid, uuid) to anon;
