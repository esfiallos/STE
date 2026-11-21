-- =====================================================================
-- Panel NOC · migración v8 — diseño v2, fase 6: rol Coordinador (docs/DISENO_V2.md §10.3)
--   Requiere 04–07. Idempotente: se puede ejecutar más de una vez.
--
--   1. Rol 'coordinador' (se otorga por SQL, sin tecnico_id) y es_coordinador().
--      Ejemplo:  insert into public.perfiles (id, nombre, rol)
--                select id, 'Nombre', 'coordinador' from auth.users where email = 'correo@empresa.com';
--   2. El coordinador lee todo (traspasos e ítems incluidos). No edita casos.
--   3. buscar_casos(termino): todos los casos alguna vez creados, con responsable actual.
--   4. estadisticas_del_dia(fecha): casos que tuvieron responsable ese día operativo, por estado actual.
--   5. alertas_coordinacion: casos sin actividad del técnico a las 2, 4 y 6 h (contando solo mientras el
--      responsable está en su turno) y recordatorios cuyo responsable no tiene jornada ese día.
--      Las genera generar_alertas_coordinacion() (pg_cron cada 5 min).
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Rol coordinador
-- ---------------------------------------------------------------------
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('dispatch', 'tecnico', 'coordinador'));

create or replace function public.es_coordinador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.mi_rol() = 'coordinador', false);
$$;

revoke all on function public.es_coordinador() from public, anon;
grant execute on function public.es_coordinador() to authenticated;

drop policy if exists "perfiles_leer" on public.perfiles;
create policy "perfiles_leer"
  on public.perfiles for select
  to authenticated
  using (id = auth.uid() or public.es_dispatch() or public.es_coordinador());

-- ---------------------------------------------------------------------
-- 2. El coordinador lee los traspasos
-- ---------------------------------------------------------------------
drop policy if exists "traspasos_leer"      on public.traspasos;
drop policy if exists "traspaso_items_leer" on public.traspaso_items;

create policy "traspasos_leer" on public.traspasos for select to authenticated
  using (public.es_dispatch() or public.es_coordinador()
         or de_tecnico_id = public.mi_tecnico_id() or public.recibi_de_traspaso(id));
create policy "traspaso_items_leer" on public.traspaso_items for select to authenticated
  using (public.es_dispatch() or public.es_coordinador() or public.es_mi_traspaso(traspaso_id, false)
         or (para_tecnico_id = public.mi_tecnico_id() and public.recibi_de_traspaso(traspaso_id)));

-- ---------------------------------------------------------------------
-- 3. Búsqueda global de casos (security invoker: respeta RLS)
-- ---------------------------------------------------------------------
drop function if exists public.buscar_casos(text, integer);
create function public.buscar_casos(p_termino text, p_limite integer default 50)
returns table (
  id uuid, codigo text, cliente text, area text, nota text, descripcion text, estado text, etiqueta text,
  ultima_actualizacion text, ultima_actualizacion_en timestamptz, ultima_actualizacion_por text,
  actividad_tecnico_en timestamptz, tecnico_actual_id uuid, tecnico_actual text,
  creado_en timestamptz, creado_por text, cerrado_en timestamptz,
  recordatorio_fecha date, recordatorio_texto text
)
language sql
stable
set search_path = public
as $$
  with t as (
    select '%' || replace(replace(replace(btrim(coalesce(p_termino, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron,
           btrim(coalesce(p_termino, '')) <> '' as hay
  )
  select c.id, c.codigo, c.cliente, c.area, c.nota, c.descripcion, c.estado, c.etiqueta,
         c.ultima_actualizacion, c.ultima_actualizacion_en, c.ultima_actualizacion_por,
         c.actividad_tecnico_en, c.tecnico_actual_id, tec.nombre,
         c.creado_en, c.creado_por, c.cerrado_en, c.recordatorio_fecha, c.recordatorio_texto
  from public.casos c
  cross join t
  left join public.tecnicos tec on tec.id = c.tecnico_actual_id
  where t.hay
    and (c.codigo ilike t.patron or c.cliente ilike t.patron or c.area ilike t.patron or c.nota ilike t.patron
         or c.descripcion ilike t.patron or c.etiqueta ilike t.patron or c.ultima_actualizacion ilike t.patron
         or tec.nombre ilike t.patron
         or exists (select 1 from public.caso_responsables r where r.caso_id = c.id and r.tecnico_nombre ilike t.patron))
  order by (c.estado = 'cerrado'), coalesce(c.actividad_tecnico_en, c.ultima_actualizacion_en, c.creado_en) desc, c.codigo
  limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

revoke all on function public.buscar_casos(text, integer) from public, anon;
grant execute on function public.buscar_casos(text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Estadísticas del día operativo
-- ---------------------------------------------------------------------
drop function if exists public.estadisticas_del_dia(date);
create function public.estadisticas_del_dia(p_fecha date default public.fecha_operativa())
returns table (estado text, total integer)
language sql
stable
set search_path = public
as $$
  select c.estado, count(*)::integer
  from public.casos c
  where exists (select 1 from public.caso_responsables r where r.caso_id = c.id and r.fecha_operativa = p_fecha)
  group by c.estado;
$$;

revoke all on function public.estadisticas_del_dia(date) from public, anon;
grant execute on function public.estadisticas_del_dia(date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Alertas para coordinación
-- ---------------------------------------------------------------------
create table if not exists public.alertas_coordinacion (
  id              uuid        primary key default gen_random_uuid(),
  tipo            text        not null check (tipo in ('sin_actualizacion', 'recordatorio_sin_jornada')),
  caso_id         uuid        not null references public.casos (id) on delete cascade,
  tecnico_id      uuid        references public.tecnicos (id) on delete set null,
  tecnico_nombre  text,
  nivel           smallint    check (nivel in (2, 4, 6)),
  referencia      timestamptz not null,
  detalle         text,
  leida           boolean     not null default false,
  creado_en       timestamptz not null default clock_timestamp(),

  constraint alerta_nivel_segun_tipo check ((tipo = 'sin_actualizacion') = (nivel is not null))
);

-- Una alerta por caso, tipo, nivel y referencia (una actualización nueva cambia la referencia).
create unique index if not exists alertas_coordinacion_unica
  on public.alertas_coordinacion (caso_id, tipo, coalesce(nivel, 0), referencia);
create index if not exists alertas_coordinacion_recientes_idx on public.alertas_coordinacion (creado_en desc);

comment on table public.alertas_coordinacion is 'Avisos para coordinación: casos sin actualización del técnico (2/4/6 h) y recordatorios sin jornada.';

alter table public.alertas_coordinacion enable row level security;

drop policy if exists "alertas_leer"   on public.alertas_coordinacion;
drop policy if exists "alertas_marcar" on public.alertas_coordinacion;
create policy "alertas_leer" on public.alertas_coordinacion for select to authenticated using (public.es_coordinador());
create policy "alertas_marcar" on public.alertas_coordinacion for update to authenticated
  using (public.es_coordinador()) with check (public.es_coordinador());

-- Desde la app solo se puede marcar como leída.
revoke insert, update, delete on public.alertas_coordinacion from anon, authenticated;
grant update (leida) on public.alertas_coordinacion to authenticated;

-- Fin del turno de un técnico un día operativo (null si no tiene jornada).
create or replace function public.fin_de_turno(p_tecnico uuid, p_fecha date)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select public.inicio_de_turno(p_tecnico, p_fecha)
         + case when j.turno = 'comodin' then j.horario_fin - j.horario_inicio else interval '8 hours' end
  from public.jornadas j
  where j.tecnico_id = p_tecnico and j.fecha_operativa = p_fecha;
$$;

revoke all on function public.fin_de_turno(uuid, date) from public, anon;
grant execute on function public.fin_de_turno(uuid, date) to authenticated;

-- Genera las alertas por falta de actualización (D12). Referencia = lo más reciente entre la última actividad
-- del técnico, cuándo recibió el caso y el inicio de su turno de hoy: las horas fuera de turno no cuentan.
-- Las alertas de una referencia anterior (el técnico ya actualizó) o de casos cerrados se marcan leídas.
-- Devuelve cuántas alertas nuevas creó.
create or replace function public.generar_alertas_coordinacion(p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha   date := public.fecha_operativa(p_ahora);
  v_caso    record;
  v_ref     timestamptz;
  v_nivel   integer;
  v_filas   integer;
  v_nuevas  integer := 0;
begin
  update public.alertas_coordinacion a set leida = true
  from public.casos c
  where c.id = a.caso_id and not a.leida and (c.estado = 'cerrado' or c.tecnico_actual_id is distinct from a.tecnico_id);

  for v_caso in
    select c.id, c.codigo, c.tecnico_actual_id, t.nombre, c.actividad_tecnico_en, r.desde,
           public.inicio_de_turno(c.tecnico_actual_id, v_fecha) as inicio,
           public.fin_de_turno(c.tecnico_actual_id, v_fecha)    as fin
    from public.casos c
    join public.tecnicos t on t.id = c.tecnico_actual_id
    left join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
    where c.estado <> 'cerrado'
  loop
    continue when v_caso.fin is null or p_ahora < v_caso.inicio or p_ahora >= v_caso.fin;
    v_ref := greatest(v_caso.inicio, v_caso.actividad_tecnico_en, v_caso.desde);

    update public.alertas_coordinacion set leida = true
    where caso_id = v_caso.id and tipo = 'sin_actualizacion' and referencia < v_ref and not leida;

    foreach v_nivel in array array[2, 4, 6] loop
      exit when p_ahora - v_ref < make_interval(hours => v_nivel);
      insert into public.alertas_coordinacion (tipo, caso_id, tecnico_id, tecnico_nombre, nivel, referencia, detalle)
      values ('sin_actualizacion', v_caso.id, v_caso.tecnico_actual_id, v_caso.nombre, v_nivel, v_ref, v_caso.codigo)
      on conflict do nothing;
      get diagnostics v_filas = row_count;
      v_nuevas := v_nuevas + v_filas;
    end loop;
  end loop;

  return v_nuevas;
end;
$$;

revoke all on function public.generar_alertas_coordinacion(timestamptz) from public, anon, authenticated;

-- generar_recordatorios (07) + aviso a coordinación si el responsable no tiene jornada ese día.
create or replace function public.generar_recordatorios(p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caso    record;
  v_avisos  integer := 0;
begin
  for v_caso in
    select c.id, c.codigo, c.tecnico_actual_id, c.recordatorio_texto, c.recordatorio_fecha, t.nombre
    from public.casos c
    join public.tecnicos t on t.id = c.tecnico_actual_id
    where c.recordatorio_fecha is not null
      and c.recordatorio_avisado_en is null
      and c.estado <> 'cerrado'
      and c.recordatorio_fecha <= public.fecha_operativa(p_ahora)
      and p_ahora >= public.inicio_de_turno(c.tecnico_actual_id, c.recordatorio_fecha)
    for update of c skip locked
  loop
    insert into public.notificaciones (tecnico_id, tipo, caso_id, detalle)
    values (v_caso.tecnico_actual_id, 'recordatorio', v_caso.id,
            v_caso.codigo || coalesce(': ' || nullif(btrim(v_caso.recordatorio_texto), ''), ''));

    if not exists (select 1 from public.jornadas j
                   where j.tecnico_id = v_caso.tecnico_actual_id and j.fecha_operativa = v_caso.recordatorio_fecha) then
      insert into public.alertas_coordinacion (tipo, caso_id, tecnico_id, tecnico_nombre, referencia, detalle)
      values ('recordatorio_sin_jornada', v_caso.id, v_caso.tecnico_actual_id, v_caso.nombre, p_ahora,
              v_caso.codigo || coalesce(': ' || nullif(btrim(v_caso.recordatorio_texto), ''), ''))
      on conflict do nothing;
    end if;

    update public.casos set recordatorio_avisado_en = p_ahora where id = v_caso.id;
    v_avisos := v_avisos + 1;
  end loop;
  return v_avisos;
end;
$$;

revoke all on function public.generar_recordatorios(timestamptz) from public, anon, authenticated;

-- Tiempo real: alertas (campana del coordinador) e ítems de traspaso.
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['alertas_coordinacion', 'traspaso_items'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabla) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabla);
    end if;
  end loop;
end;
$$;

commit;

-- =====================================================================
-- 6. Alertas cada 5 minutos (pg_cron, solo en Supabase)
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'alertas-coordinacion';

select cron.schedule(
  'alertas-coordinacion',
  '*/5 * * * *',
  $$ select public.generar_alertas_coordinacion(); $$
);
