-- =====================================================================
-- Panel NOC · v2.4 · Seguridad de lectura y protección contra casos perdidos
-- Requiere 04 a 15. Idempotente: se puede ejecutar más de una vez.
--
-- 1. Lectura solo con perfil (D32): casos, responsables, jornadas y técnicos ya no los lee cualquier sesión
--    de Supabase, solo quien tiene fila en `perfiles`. Una cuenta creada desde fuera (registro abierto) no ve
--    nada. Igual para tecnicos_de_la_ronda().
-- 2. Turno terminado sin traspaso (D33): si el turno de quien tiene un caso terminó hace más de
--    gracia_cierre_de_turno() (30 min) y no envió el traspaso de ese día (o el caso le llegó después de
--    enviarlo), el caso:
--      · lleva `sin_traspaso_desde` (= fin de ese turno) en casos_abiertos → "Por reasignar" del dispatch y
--        chip en Mi seguimiento;
--      · genera una alerta `turno_sin_traspaso` para coordinación (una por caso y turno; se da por leída sola
--        cuando el caso se traspasa, se reasigna o se cierra).
-- 3. Aviso previo (D34): 30 min antes del fin de su turno, si aún no envió el traspaso y tiene casos de hoy,
--    el técnico recibe la notificación `cierre_pendiente` (una por turno).
-- 2 y 3 los hace vigilar_cierres_de_turno(), por pg_cron cada 5 minutos (job `cierres-de-turno`).
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Lectura solo con perfil
-- ---------------------------------------------------------------------
create or replace function public.tiene_perfil()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid());
$$;
revoke all on function public.tiene_perfil() from public, anon;
grant execute on function public.tiene_perfil() to authenticated;

drop policy if exists "casos_leer"        on public.casos;
drop policy if exists "responsables_leer" on public.caso_responsables;
drop policy if exists "jornadas_leer"     on public.jornadas;
drop policy if exists "tecnicos_leer"     on public.tecnicos;

create policy "casos_leer"        on public.casos             for select to authenticated using (public.tiene_perfil());
create policy "responsables_leer" on public.caso_responsables for select to authenticated using (public.tiene_perfil());
create policy "jornadas_leer"     on public.jornadas          for select to authenticated using (public.tiene_perfil());
create policy "tecnicos_leer"     on public.tecnicos          for select to authenticated using (public.tiene_perfil());

-- Igual que la 14, solo para usuarios con perfil (la usa asignar_a_ronda con el JWT del dispatch).
create or replace function public.tecnicos_de_la_ronda(p_ahora timestamptz default now())
returns table (tecnico_id uuid, nombre text, clave text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.nombre, public.clave_de_ronda(t.nombre)
  from public.jornadas j
  join public.tecnicos t on t.id = j.tecnico_id and t.activo
  where public.tiene_perfil()
    and j.fecha_operativa = public.fecha_operativa(p_ahora)
    and public.hora_en_rango((p_ahora at time zone 'America/Tegucigalpa')::time,
          case j.turno when 'turnoA' then time '06:00' when 'turnoB' then time '14:00' else coalesce(j.horario_inicio, time '22:00') end,
          case j.turno when 'turnoA' then time '14:00' when 'turnoB' then time '22:00' else coalesce(j.horario_fin, time '06:00') end)
    and not public.hora_en_rango((p_ahora at time zone 'America/Tegucigalpa')::time, j.almuerzo_inicio, j.almuerzo_fin)
  order by public.clave_de_ronda(t.nombre) collate "C", t.nombre, t.id;
$$;
revoke all on function public.tecnicos_de_la_ronda(timestamptz) from public, anon;
grant execute on function public.tecnicos_de_la_ronda(timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Turno terminado sin traspaso
-- ---------------------------------------------------------------------
-- Tiempo que se espera después del fin del turno antes de dar un caso por "sin traspaso"
-- (y antes del fin, para el aviso previo al técnico).
create or replace function public.gracia_cierre_de_turno()
returns interval
language sql
immutable
as $$ select interval '30 minutes' $$;

-- Fin del turno en que el técnico tenía el caso (tramo del día p_fecha, desde p_desde) si ese turno terminó
-- hace más de la gracia y no envió un traspaso de ese día después de recibir el caso. Null en otro caso
-- (turno en curso o futuro, sin jornada ese día, o traspaso enviado).
create or replace function public.turno_sin_traspaso(p_tecnico uuid, p_fecha date, p_desde timestamptz,
                                                     p_ahora timestamptz default now())
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select f.fin
  from (select public.fin_de_turno(p_tecnico, p_fecha) as fin) f
  where p_tecnico is not null and p_fecha is not null
    and f.fin is not null
    and p_ahora >= f.fin + public.gracia_cierre_de_turno()
    and not exists (
      select 1 from public.traspasos t
      where t.de_tecnico_id = p_tecnico and t.fecha_operativa = p_fecha and t.estado = 'enviado'
        and t.enviado_en >= coalesce(p_desde, '-infinity'::timestamptz));
$$;
revoke all on function public.turno_sin_traspaso(uuid, date, timestamptz, timestamptz) from public, anon;
grant execute on function public.turno_sin_traspaso(uuid, date, timestamptz, timestamptz) to authenticated;

-- casos_abiertos + sin_traspaso_desde (al final: una vista solo admite columnas nuevas al final).
create or replace view public.casos_abiertos
with (security_invoker = true) as
select c.id, c.codigo, c.cliente, c.area, c.descripcion, c.nota, c.estado, c.etiqueta,
       c.tecnico_actual_id, c.ultima_actualizacion, c.ultima_actualizacion_en, c.creado_en,
       r.fecha_operativa as fecha_responsable,
       r.desde           as asignado_en,
       r.origen          as origen_responsable,
       c.ultima_actualizacion_por,
       c.actividad_tecnico_en,
       c.recordatorio_fecha,
       c.recordatorio_texto,
       public.turno_sin_traspaso(c.tecnico_actual_id, r.fecha_operativa, r.desde) as sin_traspaso_desde
from public.casos c
left join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
where c.estado <> 'cerrado';

grant select on public.casos_abiertos to authenticated;
revoke all on public.casos_abiertos from anon;

-- Alerta nueva para coordinación
alter table public.alertas_coordinacion drop constraint if exists alertas_coordinacion_tipo_check;
alter table public.alertas_coordinacion
  add constraint alertas_coordinacion_tipo_check
  check (tipo in ('sin_actualizacion', 'recordatorio_sin_jornada', 'turno_sin_traspaso'));

comment on table public.alertas_coordinacion is
  'Avisos para coordinación: casos sin actualización del técnico (2/4/6 h), recordatorios sin jornada y turnos terminados sin traspaso.';

-- ---------------------------------------------------------------------
-- 3. Aviso previo al técnico
-- ---------------------------------------------------------------------
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones
  add constraint notificaciones_tipo_check
  check (tipo in ('asignado', 'reasignado', 'traspaso', 'recordatorio', 'cancelado', 'cierre_pendiente'));

-- Lo corre pg_cron cada 5 min. Devuelve cuántas alertas y avisos nuevos creó.
create or replace function public.vigilar_cierres_de_turno(p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha      date := public.fecha_operativa(p_ahora);
  v_caso       record;
  v_jornada    record;
  v_pendientes integer;
  v_filas      integer;
  v_nuevas     integer := 0;
begin
  -- Alertas que ya no aplican: el caso se traspasó, se reasignó o se cerró.
  update public.alertas_coordinacion a set leida = true
  where a.tipo = 'turno_sin_traspaso' and not a.leida
    and not exists (
      select 1 from public.casos c
      join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
      where c.id = a.caso_id and c.estado <> 'cerrado' and c.tecnico_actual_id = a.tecnico_id
        and public.turno_sin_traspaso(c.tecnico_actual_id, r.fecha_operativa, r.desde, p_ahora) = a.referencia);

  -- Casos de un turno que terminó sin traspaso.
  for v_caso in
    select c.id, c.codigo, c.tecnico_actual_id, t.nombre,
           public.turno_sin_traspaso(c.tecnico_actual_id, r.fecha_operativa, r.desde, p_ahora) as fin
    from public.casos c
    join public.tecnicos t on t.id = c.tecnico_actual_id
    join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
    where c.estado <> 'cerrado'
  loop
    continue when v_caso.fin is null;
    insert into public.alertas_coordinacion (tipo, caso_id, tecnico_id, tecnico_nombre, referencia, detalle)
    values ('turno_sin_traspaso', v_caso.id, v_caso.tecnico_actual_id, v_caso.nombre, v_caso.fin, v_caso.codigo)
    on conflict do nothing;
    get diagnostics v_filas = row_count;
    v_nuevas := v_nuevas + v_filas;
  end loop;

  -- Aviso al técnico antes de que termine su turno de hoy.
  for v_jornada in
    select j.tecnico_id, public.fin_de_turno(j.tecnico_id, j.fecha_operativa) as fin
    from public.jornadas j
    join public.tecnicos t on t.id = j.tecnico_id and t.activo
    where j.fecha_operativa = v_fecha
  loop
    continue when v_jornada.fin is null
               or p_ahora < v_jornada.fin - public.gracia_cierre_de_turno()
               or p_ahora >= v_jornada.fin;
    continue when exists (select 1 from public.traspasos tr
                          where tr.de_tecnico_id = v_jornada.tecnico_id and tr.fecha_operativa = v_fecha
                            and tr.estado = 'enviado');
    continue when exists (select 1 from public.notificaciones n
                          where n.tecnico_id = v_jornada.tecnico_id and n.tipo = 'cierre_pendiente'
                            and n.creado_en >= v_jornada.fin - public.gracia_cierre_de_turno());

    -- Lo que tendría que traspasar hoy (no lo que ya es para un turno futuro).
    select count(*) into v_pendientes
    from public.casos c
    left join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
    where c.tecnico_actual_id = v_jornada.tecnico_id and c.estado <> 'cerrado'
      and coalesce(r.fecha_operativa, v_fecha) <= v_fecha;
    continue when v_pendientes = 0;

    insert into public.notificaciones (tecnico_id, tipo, caso_id, detalle, creado_en)
    values (v_jornada.tecnico_id, 'cierre_pendiente', null,
            'tu turno termina a las ' || to_char(v_jornada.fin at time zone 'America/Tegucigalpa', 'HH24:MI')
            || ' y tienes ' || v_pendientes || ' caso(s) por traspasar',
            p_ahora);
    v_nuevas := v_nuevas + 1;
  end loop;

  return v_nuevas;
end;
$$;
revoke all on function public.vigilar_cierres_de_turno(timestamptz) from public, anon, authenticated;

commit;

-- =====================================================================
-- 4. Vigilar los cierres de turno cada 5 minutos (pg_cron, solo en Supabase)
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'cierres-de-turno';

select cron.schedule(
  'cierres-de-turno',
  '*/5 * * * *',
  $$ select public.vigilar_cierres_de_turno(); $$
);
