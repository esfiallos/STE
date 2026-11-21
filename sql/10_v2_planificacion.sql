-- =====================================================================
-- Panel NOC · migración v10 — diseño v2, fase 8: planificación con solicitudes (docs/DISENO_V2.md §10.7)
--   Requiere 04–09. Idempotente: se puede ejecutar más de una vez.
--
--   D14 · La planificación (tabla `jornadas`, incluido el almuerzo) la edita COORDINACIÓN. Para el dispatch
--         es de solo lectura: para cambiar un día concreto envía una solicitud con fecha y motivo; si
--         coordinación la aprueba, ese día (solo ese) queda editable para el dispatch.
--         La aprobación vence al terminar el día operativo en que se aprobó (06:00 del día siguiente).
--   D15 · Nadie edita días pasados: solo de hoy (día operativo) en adelante. Lo imponen RLS y un trigger.
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Solicitudes de edición de la planificación
-- ---------------------------------------------------------------------
create table if not exists public.solicitudes_planificacion (
  id                   uuid        primary key default gen_random_uuid(),
  fecha_operativa      date        not null,
  motivo               text        not null check (length(btrim(motivo)) between 1 and 500),
  solicitante_id       uuid        references auth.users (id) on delete set null,
  solicitante_nombre   text,
  estado               text        not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  respuesta            text        check (respuesta is null or length(respuesta) <= 500),
  resuelta_por         uuid        references auth.users (id) on delete set null,
  resuelta_por_nombre  text,
  resuelta_en          timestamptz,
  -- Hasta cuándo el dispatch puede editar ese día (solo en las aprobadas)
  vence_en             timestamptz,
  -- El dispatch ya vio la respuesta (apaga el aviso de su campana)
  respuesta_vista      boolean     not null default false,
  creada_en            timestamptz not null default now(),

  constraint solicitud_resuelta_completa check ((estado = 'pendiente') = (resuelta_en is null)),
  constraint solicitud_aprobada_vence    check ((estado = 'aprobada') = (vence_en is not null))
);

-- Una sola solicitud pendiente por día
create unique index if not exists solicitudes_planificacion_pendiente_unica
  on public.solicitudes_planificacion (fecha_operativa) where estado = 'pendiente';
create index if not exists solicitudes_planificacion_recientes_idx
  on public.solicitudes_planificacion (creada_en desc);

comment on table public.solicitudes_planificacion is
  'Permisos que el dispatch pide a coordinación para editar la planificación de un día (D14).';

alter table public.solicitudes_planificacion enable row level security;

drop policy if exists "solicitudes_leer"          on public.solicitudes_planificacion;
drop policy if exists "solicitudes_marcar_vista"  on public.solicitudes_planificacion;
create policy "solicitudes_leer" on public.solicitudes_planificacion for select to authenticated
  using (public.es_dispatch() or public.es_coordinador());
create policy "solicitudes_marcar_vista" on public.solicitudes_planificacion for update to authenticated
  using (public.es_dispatch()) with check (public.es_dispatch());

-- Se crean y responden solo con las funciones de abajo; el dispatch solo puede marcar la respuesta como vista.
revoke insert, update, delete on public.solicitudes_planificacion from anon, authenticated;
grant update (respuesta_vista) on public.solicitudes_planificacion to authenticated;

-- ---------------------------------------------------------------------
-- 2. Quién puede planificar un día
-- ---------------------------------------------------------------------
-- 06:00 (Honduras) del día siguiente al día operativo de ese momento.
create or replace function public.fin_del_dia_operativo(p_momento timestamptz default now())
returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((public.fecha_operativa(p_momento) + 1) + time '06:00') at time zone 'America/Tegucigalpa';
$$;

create or replace function public.puede_planificar(p_fecha date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_fecha is not null
     and p_fecha >= public.fecha_operativa()
     and (
       public.es_coordinador()
       or (public.es_dispatch() and exists (
             select 1 from public.solicitudes_planificacion s
             where s.fecha_operativa = p_fecha and s.estado = 'aprobada' and s.vence_en > now()))
     );
$$;

revoke all on function public.puede_planificar(date) from public, anon;
grant execute on function public.puede_planificar(date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Jornadas: RLS (rol + día no pasado) y trigger (permiso del día, con mensajes claros)
-- ---------------------------------------------------------------------
drop policy if exists "jornadas_dispatch_crear"     on public.jornadas;
drop policy if exists "jornadas_dispatch_editar"    on public.jornadas;
drop policy if exists "jornadas_dispatch_borrar"    on public.jornadas;
drop policy if exists "jornadas_planificar_crear"   on public.jornadas;
drop policy if exists "jornadas_planificar_editar"  on public.jornadas;
drop policy if exists "jornadas_planificar_borrar"  on public.jornadas;

create policy "jornadas_planificar_crear" on public.jornadas for insert to authenticated
  with check ((public.es_dispatch() or public.es_coordinador()) and fecha_operativa >= public.fecha_operativa());
create policy "jornadas_planificar_editar" on public.jornadas for update to authenticated
  using      ((public.es_dispatch() or public.es_coordinador()) and fecha_operativa >= public.fecha_operativa())
  with check ((public.es_dispatch() or public.es_coordinador()) and fecha_operativa >= public.fecha_operativa());
create policy "jornadas_planificar_borrar" on public.jornadas for delete to authenticated
  using ((public.es_dispatch() or public.es_coordinador()) and fecha_operativa >= public.fecha_operativa());

create or replace function public.jornadas_validar_permiso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha date;
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
      raise exception 'Para cambiar la planificación del % pide permiso a coordinación.', to_char(v_fecha, 'DD/MM')
        using errcode = '42501';
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists jornadas_validar_permiso on public.jornadas;
create trigger jornadas_validar_permiso
  before insert or update or delete on public.jornadas
  for each row execute function public.jornadas_validar_permiso();

-- ---------------------------------------------------------------------
-- 4. Pedir y responder permisos
-- ---------------------------------------------------------------------
create or replace function public.solicitar_edicion_planificacion(p_fecha date, p_motivo text)
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
    raise exception 'Solo el dispatch pide permisos para editar la planificación.' using errcode = '42501';
  end if;
  if p_fecha is null then
    raise exception 'Indica el día que quieres editar.';
  end if;
  if p_fecha < public.fecha_operativa() then
    raise exception 'El % ya pasó: los días pasados no se planifican.', to_char(p_fecha, 'DD/MM');
  end if;
  if v_motivo = '' then
    raise exception 'Indica el motivo de la solicitud.';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'El motivo no puede pasar de 500 caracteres.';
  end if;
  if exists (select 1 from public.solicitudes_planificacion
             where fecha_operativa = p_fecha and estado = 'aprobada' and vence_en > now()) then
    raise exception 'El % ya está habilitado para editar.', to_char(p_fecha, 'DD/MM');
  end if;
  if exists (select 1 from public.solicitudes_planificacion where fecha_operativa = p_fecha and estado = 'pendiente') then
    raise exception 'Ya hay una solicitud pendiente para el %.', to_char(p_fecha, 'DD/MM') using errcode = '23505';
  end if;

  insert into public.solicitudes_planificacion (fecha_operativa, motivo, solicitante_id, solicitante_nombre)
  values (p_fecha, v_motivo, auth.uid(), (select nombre from public.perfiles where id = auth.uid()))
  returning id into v_id;

  perform public.registrar_bitacora('solicitud_planificacion', null, null,
    format('Pide editar la planificación del %s: %s', to_char(p_fecha, 'DD/MM/YYYY'), v_motivo));
  return v_id;
end;
$$;

revoke all on function public.solicitar_edicion_planificacion(date, text) from public, anon;
grant execute on function public.solicitar_edicion_planificacion(date, text) to authenticated;

create or replace function public.resolver_solicitud_planificacion(p_id uuid, p_aprobar boolean, p_respuesta text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud public.solicitudes_planificacion;
  v_respuesta text := nullif(btrim(coalesce(p_respuesta, '')), '');
begin
  if not public.es_coordinador() then
    raise exception 'Solo coordinación responde las solicitudes de planificación.' using errcode = '42501';
  end if;
  if p_aprobar is null then
    raise exception 'Indica si apruebas o rechazas la solicitud.';
  end if;
  if length(v_respuesta) > 500 then
    raise exception 'La respuesta no puede pasar de 500 caracteres.';
  end if;

  select * into v_solicitud from public.solicitudes_planificacion where id = p_id for update;
  if not found then
    raise exception 'La solicitud no existe.';
  end if;
  if v_solicitud.estado <> 'pendiente' then
    raise exception 'Esa solicitud ya fue respondida.';
  end if;
  if p_aprobar and v_solicitud.fecha_operativa < public.fecha_operativa() then
    raise exception 'El % ya pasó: no se puede aprobar.', to_char(v_solicitud.fecha_operativa, 'DD/MM');
  end if;

  update public.solicitudes_planificacion
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         respuesta = v_respuesta,
         resuelta_por = auth.uid(),
         resuelta_por_nombre = (select nombre from public.perfiles where id = auth.uid()),
         resuelta_en = now(),
         vence_en = case when p_aprobar then public.fin_del_dia_operativo() end,
         respuesta_vista = false
   where id = p_id;

  perform public.registrar_bitacora(
    case when p_aprobar then 'solicitud_planificacion_aprobada' else 'solicitud_planificacion_rechazada' end,
    null, null,
    format('Planificación del %s (pedida por %s)%s', to_char(v_solicitud.fecha_operativa, 'DD/MM/YYYY'),
           coalesce(v_solicitud.solicitante_nombre, 'dispatch'), coalesce(': ' || v_respuesta, '')));
end;
$$;

revoke all on function public.resolver_solicitud_planificacion(uuid, boolean, text) from public, anon;
grant execute on function public.resolver_solicitud_planificacion(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Tiempo real: la campana de coordinación (solicitud nueva) y la del dispatch (respuesta)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'solicitudes_planificacion') then
    alter publication supabase_realtime add table public.solicitudes_planificacion;
  end if;
end;
$$;

commit;
