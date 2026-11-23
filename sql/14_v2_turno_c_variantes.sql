-- =====================================================================
-- Panel NOC · v2.3 · Turno C en dos tramos (C1 y C2)
-- Requiere 04 a 13. Idempotente: se puede ejecutar más de una vez.
--
-- 1. El turno C se planifica por tramos: C1 22:00-00:00 y C2 00:00-06:00. Quien hace toda la noche tiene
--    los dos (se guarda como 22:00-06:00, "C1 + C2"). La jornada C lleva siempre su horario; las que había
--    sin horario (toda la noche) pasan a C1 + C2.
--    Mismos horarios que HORARIOS_TURNO_C (domain/shifts.ts); una prueba verifica que coincidan.
-- 2. Inicio y fin de turno (recordatorios, alertas de coordinación) y la ronda usan el horario del tramo.
--    C2 empieza a las 00:00, que en el reloj es el día siguiente del día operativo.
-- 3. Traspasos: sin cambios. Cualquier tramo de C es "turno C": recibe de B/Comodín el mismo día y entrega
--    a A/Comodín del día siguiente (desfase_traspaso no cambia).
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Horario de la jornada: comodín (3 fijos), turno C (C1, C2 o ambos), A y B sin horario propio
-- ---------------------------------------------------------------------
create or replace function public.horarios_turno_c()
returns table (inicio time, fin time, nombre text)
language sql
immutable
as $$
  values (time '22:00', time '00:00', 'C1'), (time '00:00', time '06:00', 'C2'), (time '22:00', time '06:00', 'C1 + C2');
$$;

alter table public.jornadas drop constraint if exists jornada_horario_comodin;
alter table public.jornadas drop constraint if exists jornada_horario_valido;

-- Las jornadas C sin horario eran toda la noche (sin bitácora: es un cambio de forma, no de planificación)
select set_config('app.origen', 'migracion', true);
update public.jornadas set horario_inicio = '22:00', horario_fin = '06:00'
where turno = 'turnoC' and (horario_inicio is null or horario_fin is null);
select set_config('app.origen', '', true);

-- "is not null" explícito: (null, null) in (...) da NULL y un CHECK con NULL se acepta.
alter table public.jornadas add constraint jornada_horario_valido check (
  coalesce(
    (turno = 'comodin' and horario_inicio is not null and horario_fin is not null and (horario_inicio, horario_fin) in (
       ('06:00'::time, '16:00'::time), ('07:00'::time, '17:00'::time), ('08:00'::time, '18:00'::time)))
    or (turno = 'turnoC' and horario_inicio is not null and horario_fin is not null and (horario_inicio, horario_fin) in (
       ('22:00'::time, '00:00'::time), ('00:00'::time, '06:00'::time), ('22:00'::time, '06:00'::time)))
    or (turno in ('turnoA', 'turnoB') and horario_inicio is null and horario_fin is null),
    false)
);

-- Bitácora y textos: "Turno C1 22:00 - 00:00", "Turno C2 00:00 - 06:00", "Turno C1 + C2 22:00 - 06:00"
create or replace function public.describir_turno(p_turno text, p_inicio time, p_fin time)
returns text
language sql
immutable
as $$
  select case p_turno
    when 'turnoA' then 'Turno A'
    when 'turnoB' then 'Turno B'
    when 'turnoC' then 'Turno ' || coalesce(
      (select h.nombre || ' ' || to_char(h.inicio, 'HH24:MI') || ' - ' || to_char(h.fin, 'HH24:MI')
       from public.horarios_turno_c() h where h.inicio = p_inicio and h.fin = p_fin), 'C')
    else 'Comodín ' || coalesce(to_char(p_inicio, 'HH24:MI') || ' - ' || to_char(p_fin, 'HH24:MI'), '')
  end;
$$;

-- ---------------------------------------------------------------------
-- 2. Inicio y fin del turno de un técnico un día operativo (horas antes de las 06:00 = día siguiente)
-- ---------------------------------------------------------------------
create or replace function public.inicio_de_turno(p_tecnico uuid, p_fecha date)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with h as (
    select coalesce(
             (select case j.turno
                       when 'turnoA' then time '06:00'
                       when 'turnoB' then time '14:00'
                       else coalesce(j.horario_inicio, time '22:00')
                     end
              from public.jornadas j
              where j.tecnico_id = p_tecnico and j.fecha_operativa = p_fecha),
             time '06:00') as hora
  )
  select ((p_fecha + case when h.hora < time '06:00' then 1 else 0 end) + h.hora)::timestamp
         at time zone 'America/Tegucigalpa'
  from h;
$$;

create or replace function public.fin_de_turno(p_tecnico uuid, p_fecha date)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select public.inicio_de_turno(p_tecnico, p_fecha)
         + case
             when j.horario_inicio is null or j.horario_fin is null then interval '8 hours'
             when j.horario_fin > j.horario_inicio then j.horario_fin - j.horario_inicio
             else j.horario_fin - j.horario_inicio + interval '24 hours'
           end
  from public.jornadas j
  where j.tecnico_id = p_tecnico and j.fecha_operativa = p_fecha;
$$;

-- ---------------------------------------------------------------------
-- 3. Ronda: está en horario según el tramo de C que tenga
-- ---------------------------------------------------------------------
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
  where j.fecha_operativa = public.fecha_operativa(p_ahora)
    and public.hora_en_rango((p_ahora at time zone 'America/Tegucigalpa')::time,
          case j.turno when 'turnoA' then time '06:00' when 'turnoB' then time '14:00' else coalesce(j.horario_inicio, time '22:00') end,
          case j.turno when 'turnoA' then time '14:00' when 'turnoB' then time '22:00' else coalesce(j.horario_fin, time '06:00') end)
    and not public.hora_en_rango((p_ahora at time zone 'America/Tegucigalpa')::time, j.almuerzo_inicio, j.almuerzo_fin)
  order by public.clave_de_ronda(t.nombre) collate "C", t.nombre, t.id;
$$;

revoke all on function public.tecnicos_de_la_ronda(timestamptz) from public, anon;
grant execute on function public.tecnicos_de_la_ronda(timestamptz) to authenticated;

commit;
