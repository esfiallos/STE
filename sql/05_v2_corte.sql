-- =====================================================================
-- Panel NOC · migración v5 — diseño v2, fase 2: CORTE al modelo nuevo
--   Requiere 04_v2_modelo_base.sql. Ejecutar JUSTO ANTES de publicar la app v2:
--   a partir de aquí la app anterior (incidentes / turno fijo) deja de funcionar.
--
--   1. Resincroniza lo que la app anterior cambió desde la 04 (incidentes → casos, turno → jornada de hoy)
--   2. Elimina `incidentes` y el turno fijo de `tecnicos`
--   3. Técnicos: nombre único, activar/desactivar, solo el dispatch los modifica
--   4. Vista `casos_abiertos` para el tablero
--   5. El snapshot pasa a ser el del día operativo (cron a las 05:59, ver bloque final)
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- La resincronización no debe llenar la bitácora ni notificar a nadie.
create or replace function public.registrar_bitacora(
  p_accion text, p_codigo text, p_tecnico text, p_detalle text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.origen', true) = 'migracion' then
    return;
  end if;
  insert into public.bitacora (usuario_id, usuario_email, accion, codigo, tecnico, detalle)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'sistema'), p_accion, p_codigo, p_tecnico, p_detalle);
end;
$$;

revoke all on function public.registrar_bitacora(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Resincronización (solo si todavía existe el modelo anterior)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.incidentes') is null then
    return; -- la migración ya se ejecutó antes
  end if;

  perform set_config('app.origen', 'migracion', true);

  -- Turno fijo de hoy → jornada de hoy (los comodines fuera de la lista fija se planifican a mano)
  insert into public.jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin, almuerzo_inicio, almuerzo_fin)
  select public.fecha_operativa(), t.id, t.turno,
         case when t.turno = 'comodin' then t.horario_inicio end,
         case when t.turno = 'comodin' then t.horario_fin end,
         t.almuerzo_inicio, t.almuerzo_fin
  from public.tecnicos t
  where t.turno is not null
    and (t.turno <> 'comodin' or (t.horario_inicio, t.horario_fin) in (
          ('06:00'::time, '16:00'::time), ('07:00'::time, '17:00'::time), ('08:00'::time, '18:00'::time)))
  on conflict (fecha_operativa, tecnico_id) do nothing;

  -- Incidentes creados después de la 04
  insert into public.casos (codigo, nota, estado, tecnico_actual_id, creado_en, creado_por)
  select i.codigo, i.nota, 'en_curso', i.tecnico_id, i.created_at, 'migracion'
  from public.incidentes i
  on conflict (codigo) do nothing;

  -- Incidentes reasignados después de la 04
  update public.casos c
     set tecnico_actual_id = i.tecnico_id, nota = i.nota
    from public.incidentes i
   where i.codigo = c.codigo and c.estado <> 'cerrado'
     and (c.tecnico_actual_id is distinct from i.tecnico_id or c.nota is distinct from i.nota);

  -- Incidentes que la app anterior eliminó (= cerró) después de la 04
  update public.casos c
     set estado = 'cerrado'
   where c.creado_por = 'migracion' and c.estado <> 'cerrado'
     and not exists (select 1 from public.incidentes i where i.codigo = c.codigo);

  perform set_config('app.origen', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Fuera el modelo anterior
-- ---------------------------------------------------------------------
drop function if exists public.generar_snapshot_diario(date);
drop table if exists public.incidentes cascade;
drop function if exists public.bitacora_incidentes();
drop function if exists public.normalizar_codigo_incidente() cascade;

-- ---------------------------------------------------------------------
-- 3. Técnicos: solo nombre y si está activo (el turno vive en la jornada de cada día)
-- ---------------------------------------------------------------------
do $$
declare
  v_repetidos text;
begin
  select string_agg(distinct nombre, ', ') into v_repetidos
  from public.tecnicos t
  where exists (select 1 from public.tecnicos o where o.id <> t.id and lower(btrim(o.nombre)) = lower(btrim(t.nombre)));
  if v_repetidos is not null then
    raise exception 'Hay técnicos con el mismo nombre (%). Renombra o elimina los repetidos y vuelve a ejecutar.', v_repetidos;
  end if;
end;
$$;

drop trigger if exists bitacora_tecnicos_trg on public.tecnicos;

alter table public.tecnicos
  drop column if exists turno,
  drop column if exists horario_inicio,
  drop column if exists horario_fin,
  drop column if exists almuerzo_inicio,
  drop column if exists almuerzo_fin;

drop index if exists public.tecnicos_nombre_unico_v2;
create unique index if not exists tecnicos_nombre_unico on public.tecnicos (lower(btrim(nombre)));

comment on table public.tecnicos is 'Catálogo de técnicos. El turno de cada día está en jornadas. No se borran: se desactivan.';

create or replace function public.bitacora_tecnicos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.registrar_bitacora('tecnico_agregado', null, new.nombre, null);
  elsif tg_op = 'UPDATE' then
    if new.nombre is distinct from old.nombre then
      perform public.registrar_bitacora('tecnico_renombrado', null, new.nombre, 'Antes: ' || old.nombre);
    end if;
    if new.activo is distinct from old.activo then
      perform public.registrar_bitacora(case when new.activo then 'tecnico_activado' else 'tecnico_desactivado' end,
                                        null, new.nombre, null);
    end if;
  else
    perform public.registrar_bitacora('tecnico_eliminado', null, old.nombre, null);
  end if;
  return null;
end;
$$;

create trigger bitacora_tecnicos_trg
  after insert or update or delete on public.tecnicos
  for each row execute function public.bitacora_tecnicos();

-- Todos leen el catálogo; solo el dispatch lo modifica.
drop policy if exists "tecnicos_usuarios_autenticados" on public.tecnicos;
drop policy if exists "tecnicos_leer"                  on public.tecnicos;
drop policy if exists "tecnicos_dispatch_crear"        on public.tecnicos;
drop policy if exists "tecnicos_dispatch_editar"       on public.tecnicos;
drop policy if exists "tecnicos_dispatch_borrar"       on public.tecnicos;

create policy "tecnicos_leer"            on public.tecnicos for select to authenticated using (true);
create policy "tecnicos_dispatch_crear"  on public.tecnicos for insert to authenticated with check (public.es_dispatch());
create policy "tecnicos_dispatch_editar" on public.tecnicos for update to authenticated using (public.es_dispatch()) with check (public.es_dispatch());
create policy "tecnicos_dispatch_borrar" on public.tecnicos for delete to authenticated using (public.es_dispatch());

-- ---------------------------------------------------------------------
-- 4. Tablero: casos no cerrados con su responsable vigente y el día operativo en que lo tiene.
--    security_invoker: respeta las políticas RLS de quien consulta.
-- ---------------------------------------------------------------------
create or replace view public.casos_abiertos
with (security_invoker = true) as
select c.id, c.codigo, c.cliente, c.area, c.descripcion, c.nota, c.estado, c.etiqueta,
       c.tecnico_actual_id, c.ultima_actualizacion, c.ultima_actualizacion_en, c.creado_en,
       r.fecha_operativa as fecha_responsable,
       r.desde           as asignado_en
from public.casos c
left join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
where c.estado <> 'cerrado';

grant select on public.casos_abiertos to authenticated;
revoke all on public.casos_abiertos from anon;

commit;

-- =====================================================================
-- 5. Snapshot diario del día operativo a las 05:59 de Honduras (= 11:59 UTC)
--    Va fuera de la transacción: si falla, habilita pg_cron en
--    Database > Extensions y vuelve a ejecutar SOLO este bloque.
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'snapshot-diario';

select cron.schedule(
  'snapshot-operativo',
  '59 11 * * *',
  $$ select public.generar_snapshot_operativo(); $$
);

-- Para probar ahora mismo (foto del día operativo en curso):
--   select public.generar_snapshot_operativo();
-- Para ver la programación:   select * from cron.job;
