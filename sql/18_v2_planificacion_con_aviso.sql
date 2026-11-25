-- =====================================================================
-- Panel NOC · v2.7 · Planificación con aviso (el dispatch cambia sin esperar aprobación)
-- Requiere 04 a 17. Idempotente: se puede ejecutar más de una vez.
--
-- D38 (reemplaza D14): el dispatch planifica de hoy en adelante sin pedir permiso. La primera vez que cambia un
-- día (turno, comodín o "Libre") indica el MOTIVO; ese aviso vale para ese día hasta el fin del día operativo en
-- curso (06:00) y cada cambio que haga queda anotado en él (técnico, antes → después, quién). Coordinación lo
-- recibe en su campana, solo para enterarse: no aprueba ni rechaza.
--   · El almuerzo no pide motivo: el dispatch lo ajusta libre (planificación o tablero del día).
--   · D15 se mantiene: nadie toca días pasados.
--   · Coordinación planifica como antes (sin motivo).
--   · Las solicitudes de la migración 10 quedan como historial: se retiran sus funciones.
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Avisos de cambio
-- ---------------------------------------------------------------------
create table if not exists public.avisos_planificacion (
  id               uuid        primary key default gen_random_uuid(),
  fecha_operativa  date        not null,
  motivo           text        not null check (length(btrim(motivo)) between 1 and 500),
  autor_id         uuid        references auth.users (id) on delete set null,
  autor_nombre     text,
  creado_en        timestamptz not null default now(),
  -- Hasta cuándo el motivo cubre los cambios de ese día (fin del día operativo en que se dio)
  vence_en         timestamptz not null,
  -- [{ "en", "por", "tecnico", "antes", "despues" }] (los agrega el trigger de jornadas)
  cambios          jsonb       not null default '[]'::jsonb,
  -- Coordinación ya lo vio (apaga el aviso de su campana)
  visto            boolean     not null default false
);

-- Un motivo por día planificado y día operativo en que se cambia (lo comparten los dispatch de ese día)
create unique index if not exists avisos_planificacion_unico on public.avisos_planificacion (fecha_operativa, vence_en);
create index if not exists avisos_planificacion_recientes_idx on public.avisos_planificacion (creado_en desc);

comment on table public.avisos_planificacion is
  'Motivo con el que el dispatch cambió la planificación de un día y el detalle de los cambios (D38). Solo informativo.';

alter table public.avisos_planificacion enable row level security;

drop policy if exists "avisos_planificacion_leer"         on public.avisos_planificacion;
drop policy if exists "avisos_planificacion_marcar_visto" on public.avisos_planificacion;
create policy "avisos_planificacion_leer" on public.avisos_planificacion for select to authenticated
  using (public.es_dispatch() or public.es_coordinador());
create policy "avisos_planificacion_marcar_visto" on public.avisos_planificacion for update to authenticated
  using (public.es_coordinador()) with check (public.es_coordinador());

-- Se crean con avisar_cambio_planificacion() y se completan con el trigger; coordinación solo marca "visto".
revoke insert, update, delete on public.avisos_planificacion from anon, authenticated;
grant update (visto) on public.avisos_planificacion to authenticated;

-- Aviso vigente para ese día (null si el dispatch aún no dio el motivo).
create or replace function public.aviso_de_planificacion(p_fecha date, p_ahora timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.avisos_planificacion
  where fecha_operativa = p_fecha and vence_en > p_ahora
  order by creado_en desc
  limit 1;
$$;

revoke all on function public.aviso_de_planificacion(date, timestamptz) from public, anon;
grant execute on function public.aviso_de_planificacion(date, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Quién planifica un día: dispatch y coordinación, de hoy en adelante (D38 + D15)
-- ---------------------------------------------------------------------
create or replace function public.puede_planificar(p_fecha date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_fecha is not null
     and p_fecha >= public.fecha_operativa()
     and (public.es_coordinador() or public.es_dispatch());
$$;

-- ---------------------------------------------------------------------
-- 3. Jornadas: el dispatch necesita el motivo del día, salvo para el almuerzo
-- ---------------------------------------------------------------------
create or replace function public.jornadas_validar_permiso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha   date;
  v_aviso   uuid;
  v_antes   text;
  v_despues text;
begin
  -- Procesos del sistema (migraciones, cron, SQL Editor) no tienen usuario: no se limitan.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  foreach v_fecha in array array_remove(array[
      case when tg_op <> 'INSERT' then old.fecha_operativa end,
      case when tg_op <> 'DELETE' then new.fecha_operativa end], null)
  loop
    if v_fecha < public.fecha_operativa() then
      raise exception 'El % ya pasó: los días pasados de la planificación no se modifican.', to_char(v_fecha, 'DD/MM')
        using errcode = '42501';
    end if;
    if not public.puede_planificar(v_fecha) then
      raise exception 'Solo dispatch y coordinación planifican.' using errcode = '42501';
    end if;
  end loop;

  -- Coordinación planifica sin motivo.
  if public.es_coordinador() or not public.es_dispatch() then
    return coalesce(new, old);
  end if;

  -- El almuerzo (o guardar lo mismo) no es un cambio de turno: no pide motivo.
  if tg_op = 'UPDATE'
     and (new.fecha_operativa, new.tecnico_id, new.turno, new.horario_inicio, new.horario_fin)
         is not distinct from (old.fecha_operativa, old.tecnico_id, old.turno, old.horario_inicio, old.horario_fin) then
    return new;
  end if;

  -- Un upsert (insert … on conflict do update) dispara antes el BEFORE INSERT: si la fila ya existe, el cambio
  -- lo anota el BEFORE UPDATE que sigue, con el turno de antes.
  if tg_op = 'INSERT' and exists (
       select 1 from public.jornadas where fecha_operativa = new.fecha_operativa and tecnico_id = new.tecnico_id) then
    return new;
  end if;

  v_fecha := case when tg_op = 'DELETE' then old.fecha_operativa else new.fecha_operativa end;
  v_aviso := public.aviso_de_planificacion(v_fecha);
  if v_aviso is null then
    raise exception 'Para cambiar la planificación del % indica el motivo del cambio.', to_char(v_fecha, 'DD/MM')
      using errcode = '42501';
  end if;

  v_antes   := case when tg_op = 'INSERT' then 'Libre' else public.describir_turno(old.turno, old.horario_inicio, old.horario_fin) end;
  v_despues := case when tg_op = 'DELETE' then 'Libre' else public.describir_turno(new.turno, new.horario_inicio, new.horario_fin) end;

  update public.avisos_planificacion
     set cambios = cambios || jsonb_build_array(jsonb_build_object(
           'en', now(),
           'por', (select nombre from public.perfiles where id = auth.uid()),
           'tecnico', (select nombre from public.tecnicos where id = coalesce(new.tecnico_id, old.tecnico_id)),
           'antes', v_antes,
           'despues', v_despues)),
         visto = false
   where id = v_aviso;

  return coalesce(new, old);
end;
$$;

drop trigger if exists jornadas_validar_permiso on public.jornadas;
create trigger jornadas_validar_permiso
  before insert or update or delete on public.jornadas
  for each row execute function public.jornadas_validar_permiso();

-- ---------------------------------------------------------------------
-- 4. Dar el motivo del día (dispatch)
-- ---------------------------------------------------------------------
create or replace function public.avisar_cambio_planificacion(p_fecha date, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_id     uuid;
begin
  if not public.es_dispatch() then
    raise exception 'Solo el dispatch avisa los cambios de la planificación.' using errcode = '42501';
  end if;
  if p_fecha is null then
    raise exception 'Indica el día que cambias.';
  end if;
  if p_fecha < public.fecha_operativa() then
    raise exception 'El % ya pasó: los días pasados no se planifican.', to_char(p_fecha, 'DD/MM');
  end if;
  if v_motivo = '' then
    raise exception 'Indica el motivo del cambio.';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'El motivo no puede pasar de 500 caracteres.';
  end if;

  -- Si ya hay un motivo para ese día, sirve el mismo (una vez por día).
  v_id := public.aviso_de_planificacion(p_fecha);
  if v_id is not null then
    return v_id;
  end if;

  insert into public.avisos_planificacion (fecha_operativa, motivo, autor_id, autor_nombre, vence_en)
  values (p_fecha, v_motivo, auth.uid(), (select nombre from public.perfiles where id = auth.uid()),
          public.fin_del_dia_operativo())
  on conflict (fecha_operativa, vence_en) do nothing
  returning id into v_id;
  -- Otro dispatch lo dio al mismo tiempo
  if v_id is null then
    v_id := public.aviso_de_planificacion(p_fecha);
  end if;

  perform public.registrar_bitacora('aviso_planificacion', null, null,
    format('Cambia la planificación del %s: %s', to_char(p_fecha, 'DD/MM/YYYY'), v_motivo));
  return v_id;
end;
$$;

revoke all on function public.avisar_cambio_planificacion(date, text) from public, anon;
grant execute on function public.avisar_cambio_planificacion(date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Se retiran las solicitudes (D14): la tabla queda como historial, de solo lectura
-- ---------------------------------------------------------------------
drop function if exists public.solicitar_edicion_planificacion(date, text);
drop function if exists public.resolver_solicitud_planificacion(uuid, boolean, text);

-- ---------------------------------------------------------------------
-- 6. Tiempo real: la campana de coordinación
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'avisos_planificacion') then
    alter publication supabase_realtime add table public.avisos_planificacion;
  end if;
end;
$$;

commit;
