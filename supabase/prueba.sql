-- Limpia la sede desechable «prueba». Solo la puede ejecutar el rol postgres (psql), nunca anon.
create or replace function prueba_reset() returns void
language sql security definer set search_path = public as $$
  delete from respuestas where sede = 'prueba';
  delete from sesiones where persona_id in (select id from personas where sede = 'prueba');
  update personas set equipo_id = null where sede = 'prueba';
  delete from personas where sede = 'prueba';
  delete from equipos where sede = 'prueba';
  update estado_actividad set estado = 'cerrada', abierta_en = null where sede = 'prueba';
  update sedes set equipos_estado = 'cerrada' where id = 'prueba';
$$;
revoke execute on function prueba_reset() from public, anon, authenticated;
