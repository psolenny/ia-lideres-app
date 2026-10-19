-- Limpia las sedes desechables «prueba» y «prueba2». Solo la puede ejecutar el rol postgres (psql), nunca anon.
create or replace function prueba_reset() returns void
language sql security definer set search_path = public as $$
  delete from respuestas where sede in ('prueba', 'prueba2');
  delete from sesiones where persona_id in (select id from personas where sede in ('prueba', 'prueba2'));
  update personas set equipo_id = null where sede in ('prueba', 'prueba2');
  delete from personas where sede in ('prueba', 'prueba2');
  delete from equipos where sede in ('prueba', 'prueba2');
  update estado_actividad set estado = 'cerrada', abierta_en = null where sede in ('prueba', 'prueba2');
  update sedes set equipos_estado = 'cerrada' where id in ('prueba', 'prueba2');
$$;
revoke execute on function prueba_reset() from public, anon, authenticated;
