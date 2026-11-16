-- =====================================================================
-- Panel NOC · migración v3  (conserva tus datos actuales)
--   1. Turno "comodín" con horario propio
--   2. Bitácora: quién hizo qué (se registra sola, desde la base de datos)
--   3. Snapshot diario automático + búsquedas en el historial
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Técnicos: turno comodín (horario propio que abarca varios turnos)
-- ---------------------------------------------------------------------
alter table public.tecnicos
  add column if not exists horario_inicio time,
  add column if not exists horario_fin    time;

alter table public.tecnicos drop constraint if exists tecnicos_turno_check;
alter table public.tecnicos add constraint tecnicos_turno_check
  check (turno in ('turnoA', 'turnoB', 'turnoC', 'comodin'));

alter table public.tecnicos drop constraint if exists comodin_requiere_horario;
alter table public.tecnicos add constraint comodin_requiere_horario
  check (
    turno <> 'comodin'
    or (horario_inicio is not null and horario_fin is not null and horario_inicio <> horario_fin)
  );

-- ---------------------------------------------------------------------
-- 2. Bitácora (solo lectura para la app; la escriben los triggers)
-- ---------------------------------------------------------------------
create table if not exists public.bitacora (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz not null default clock_timestamp(), -- hora exacta de cada evento, no la del inicio de la transacción
  usuario_id     uuid,
  usuario_email  text        not null default 'sistema',
  accion         text        not null,
  codigo         text,
  tecnico        text,
  detalle        text
);

-- Si la tabla ya existía (migración ejecutada antes), actualiza también su valor por defecto.
alter table public.bitacora alter column created_at set default clock_timestamp();

create index if not exists bitacora_created_at_idx on public.bitacora (created_at desc);
create index if not exists bitacora_codigo_idx     on public.bitacora (codigo);

alter table public.bitacora enable row level security;

drop policy if exists "bitacora_leer_autenticados" on public.bitacora;
create policy "bitacora_leer_autenticados"
  on public.bitacora for select
  to authenticated
  using (true);
-- Sin políticas de insert/update/delete: nadie puede escribir, editar ni borrar desde la app.

create or replace function public.registrar_bitacora(
  p_accion text, p_codigo text, p_tecnico text, p_detalle text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bitacora (usuario_id, usuario_email, accion, codigo, tecnico, detalle)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'sistema'), p_accion, p_codigo, p_tecnico, p_detalle);
end;
$$;

-- Que nadie pueda inventar entradas llamando a la función desde la app.
revoke all on function public.registrar_bitacora(text, text, text, text) from public, anon, authenticated;

create or replace function public.bitacora_incidentes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viejo text;
  v_nuevo text;
begin
  if tg_op = 'INSERT' then
    select nombre into v_nuevo from public.tecnicos where id = new.tecnico_id;
    perform public.registrar_bitacora('incidente_asignado', new.codigo, v_nuevo, new.nota);

  elsif tg_op = 'UPDATE' then
    if new.tecnico_id is distinct from old.tecnico_id then
      select nombre into v_viejo from public.tecnicos where id = old.tecnico_id;
      select nombre into v_nuevo from public.tecnicos where id = new.tecnico_id;
      perform public.registrar_bitacora(
        'incidente_reasignado', new.codigo, v_nuevo,
        'De ' || coalesce(v_viejo, '?') || ' a ' || coalesce(v_nuevo, '?')
      );
    end if;

  elsif tg_op = 'DELETE' then
    select nombre into v_viejo from public.tecnicos where id = old.tecnico_id;
    perform public.registrar_bitacora(
      'incidente_eliminado', old.codigo, v_viejo,
      case when v_viejo is null then 'Se eliminó junto con su técnico' end
    );
  end if;

  return null;
end;
$$;

drop trigger if exists bitacora_incidentes_trg on public.incidentes;
create trigger bitacora_incidentes_trg
  after insert or update or delete on public.incidentes
  for each row execute function public.bitacora_incidentes();

create or replace function public.bitacora_tecnicos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.registrar_bitacora(
      'tecnico_agregado', null, new.nombre,
      case new.turno
        when 'turnoA'  then 'Turno A'
        when 'turnoB'  then 'Turno B'
        when 'turnoC'  then 'Turno C'
        else 'Comodín ' || to_char(new.horario_inicio, 'HH24:MI') || ' - ' || to_char(new.horario_fin, 'HH24:MI')
      end
    );

  elsif tg_op = 'UPDATE' then
    if new.almuerzo_inicio is distinct from old.almuerzo_inicio
       or new.almuerzo_fin is distinct from old.almuerzo_fin then
      perform public.registrar_bitacora(
        'almuerzo_actualizado', null, new.nombre,
        case when new.almuerzo_inicio is null
             then 'Horario de almuerzo eliminado'
             else to_char(new.almuerzo_inicio, 'HH24:MI') || ' - ' || to_char(new.almuerzo_fin, 'HH24:MI')
        end
      );
    end if;

  elsif tg_op = 'DELETE' then
    perform public.registrar_bitacora('tecnico_eliminado', null, old.nombre, null);
  end if;

  return null;
end;
$$;

drop trigger if exists bitacora_tecnicos_trg on public.tecnicos;
create trigger bitacora_tecnicos_trg
  after insert or update or delete on public.tecnicos
  for each row execute function public.bitacora_tecnicos();

-- ---------------------------------------------------------------------
-- 3. Snapshot diario: lo genera la base de datos, ya no la app
-- ---------------------------------------------------------------------
drop policy if exists "snapshots_guardar_autenticados"     on public.historial_snapshots;
drop policy if exists "snapshots_actualizar_autenticados"  on public.historial_snapshots;

create or replace function public.generar_snapshot_diario(
  p_fecha date default (now() at time zone 'America/Tegucigalpa')::date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.historial_snapshots (fecha, datos_panel)
  select
    p_fecha,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',             t.id,
        'nombre',         t.nombre,
        'turno',          t.turno,
        'horarioInicio',  to_char(t.horario_inicio,  'HH24:MI'),
        'horarioFin',     to_char(t.horario_fin,     'HH24:MI'),
        'almuerzoInicio', to_char(t.almuerzo_inicio, 'HH24:MI'),
        'almuerzoFin',    to_char(t.almuerzo_fin,    'HH24:MI'),
        'incidentes', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'id', i.id, 'codigo', i.codigo, 'nota', i.nota,
                     'tecnicoId', i.tecnico_id, 'creadoEn', i.created_at
                   ) order by i.created_at)
          from public.incidentes i
          where i.tecnico_id = t.id
        ), '[]'::jsonb)
      ) order by t.nombre
    ), '[]'::jsonb)
  from public.tecnicos t
  on conflict (fecha) do update
    set datos_panel = excluded.datos_panel, created_at = now();
end;
$$;

-- Solo el sistema (cron) o el SQL Editor pueden generarlo; la app no.
revoke all on function public.generar_snapshot_diario(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Búsquedas en el historial (respetan RLS: solo usuarios con sesión)
-- ---------------------------------------------------------------------
create or replace function public.buscar_en_historial(p_termino text)
returns table (fecha date, codigo text, nota text, tecnico text, turno text)
language sql
stable
set search_path = public
as $$
  select s.fecha,
         i.inc ->> 'codigo',
         i.inc ->> 'nota',
         t.tec ->> 'nombre',
         t.tec ->> 'turno'
  from public.historial_snapshots s
  cross join lateral jsonb_array_elements(s.datos_panel) as t(tec)
  cross join lateral jsonb_array_elements(coalesce(t.tec -> 'incidentes', '[]'::jsonb)) as i(inc)
  where btrim(p_termino) <> ''
    and position(
          lower(btrim(p_termino)) in
          lower(coalesce(i.inc ->> 'codigo', '') || ' ' || coalesce(i.inc ->> 'nota', '') || ' ' || coalesce(t.tec ->> 'nombre', ''))
        ) > 0
  order by s.fecha desc, i.inc ->> 'codigo'
  limit 300;
$$;

create or replace function public.buscar_en_bitacora(p_termino text)
returns setof public.bitacora
language sql
stable
set search_path = public
as $$
  select *
  from public.bitacora
  where btrim(p_termino) <> ''
    and position(
          lower(btrim(p_termino)) in
          lower(coalesce(codigo, '') || ' ' || coalesce(tecnico, '') || ' ' || coalesce(usuario_email, '') || ' ' || coalesce(detalle, ''))
        ) > 0
  order by created_at desc
  limit 300;
$$;

commit;

-- =====================================================================
-- 5. Programar el snapshot diario a las 23:59 (hora de Honduras = 05:59 UTC)
--    Va fuera de la transacción: si falla, habilita pg_cron en
--    Database > Extensions y vuelve a ejecutar SOLO este bloque.
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'snapshot-diario',
  '59 5 * * *',
  $$ select public.generar_snapshot_diario(); $$
);

-- Para probar ahora mismo (genera el snapshot de hoy):
--   select public.generar_snapshot_diario();
-- Para ver la programación:   select * from cron.job;
-- Para cambiar la hora: vuelve a ejecutar cron.schedule con otro horario (en UTC).
