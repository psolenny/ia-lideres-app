-- Acceso: registrar, entrar y validar sesión. Correo @cecomsa.com + PIN de 4 dígitos.

create or replace function sesion(p_token uuid) returns personas
language plpgsql security definer set search_path = public as $$
declare p personas;
begin
  select pe.* into p from sesiones s join personas pe on pe.id = s.persona_id where s.token = p_token;
  if not found then raise exception 'sesion_invalida'; end if;
  return p;
end $$;
revoke execute on function sesion(uuid) from public, anon, authenticated;

create or replace function persona_json(p personas) returns json
language sql stable set search_path = public as $$
  select json_build_object('id', p.id, 'nombre', p.nombre, 'apellido', p.apellido, 'sede', p.sede, 'es_facilitadora', p.es_facilitadora);
$$;
revoke execute on function persona_json(personas) from public, anon, authenticated;

-- Crea la persona sin validar dominio. La usan registrar() y f_registrar().
create or replace function crear_persona(p_sede text, p_nombre text, p_apellido text, p_correo text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p personas; v_token uuid; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if not exists (select 1 from sedes where id = p_sede) then raise exception 'sede_invalida'; end if;
  if trim(coalesce(p_nombre, '')) = '' or trim(coalesce(p_apellido, '')) = '' then raise exception 'datos_incompletos'; end if;
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo_invalido'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'pin_invalido'; end if;
  if exists (select 1 from personas where sede = p_sede and correo = v_correo) then raise exception 'ya_registrado'; end if;
  insert into personas (sede, nombre, apellido, correo, pin_hash)
    values (p_sede, left(trim(p_nombre), 60), left(trim(p_apellido), 60), v_correo, crypt(p_pin, gen_salt('bf')))
    returning * into p;
  insert into sesiones (persona_id) values (p.id) returning token into v_token;
  return json_build_object('token', v_token, 'persona', persona_json(p));
exception when unique_violation then raise exception 'ya_registrado';
end $$;
revoke execute on function crear_persona(text, text, text, text, text) from public, anon, authenticated;

create or replace function registrar(p_sede text, p_nombre text, p_apellido text, p_correo text, p_pin text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from sedes where id = p_sede) then raise exception 'sede_invalida'; end if;
  if trim(coalesce(p_nombre, '')) = '' or trim(coalesce(p_apellido, '')) = '' then raise exception 'datos_incompletos'; end if;
  if lower(trim(coalesce(p_correo, ''))) !~ '^[^@\s]+@cecomsa\.com$' then raise exception 'correo_invalido'; end if;
  return crear_persona(p_sede, p_nombre, p_apellido, p_correo, p_pin);
end $$;

create or replace function entrar(p_sede text, p_correo text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p personas; v_token uuid;
begin
  select * into p from personas where sede = p_sede and correo = lower(trim(coalesce(p_correo, ''))) for update;
  if not found then raise exception 'credenciales'; end if;
  if p.bloqueado_hasta is not null and p.bloqueado_hasta > now() and not p.es_facilitadora then raise exception 'bloqueado'; end if;
  if p.pin_hash <> crypt(coalesce(p_pin, ''), p.pin_hash) then
    -- Un raise desharía este update, así que el fallo se devuelve como {error} en vez de excepción.
    -- La facilitadora no se bloquea (nadie puede dejarla fuera); su clave es larga, no un PIN.
    if not p.es_facilitadora then
      update personas set intentos = intentos + 1,
        bloqueado_hasta = case when intentos + 1 >= 5 then now() + interval '5 minutes' end
        where id = p.id;
    end if;
    return json_build_object('error', 'credenciales');
  end if;
  update personas set intentos = 0, bloqueado_hasta = null where id = p.id;
  insert into sesiones (persona_id) values (p.id) returning token into v_token;
  return json_build_object('token', v_token, 'persona', persona_json(p));
end $$;

grant execute on function registrar(text, text, text, text, text) to anon;
grant execute on function entrar(text, text, text) to anon;
