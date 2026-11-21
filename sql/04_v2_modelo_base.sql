-- =====================================================================
-- Panel NOC · migración v4 — diseño v2, fase 1 (conserva tus datos)
--   0. Día operativo (06:00 → 06:00, hora de Honduras) y reglas de traspaso
--   1. Técnicos sin turno fijo
--   2. Perfiles y roles (dispatch / técnico)
--   3. Jornadas: el turno de cada técnico por día (planificación del dispatch)
--   4. Casos persistentes + historial de responsables
--   5. Notificaciones
--   6. Traspasos y su envío transaccional
--   7. Snapshot del día operativo
--   8. Tiempo real
--   9. Copia de los datos actuales al modelo nuevo
--
-- Es ADITIVA: no borra `incidentes` ni `tecnicos.turno`, así la app actual sigue funcionando
-- hasta el corte de la fase 2 (que además reprogramará el cron del snapshot a las 05:59).
-- Se puede ejecutar varias veces: el paso 9 solo copia lo que falte.
--
-- Roles (solo por SQL, decisión D3). Ejemplo, después de crear el usuario en Authentication:
--   insert into public.perfiles (id, nombre, rol) values ('<uuid de auth.users>', 'Nombre', 'dispatch');
--   insert into public.perfiles (id, nombre, rol, tecnico_id) values ('<uuid>', 'Ana', 'tecnico', '<uuid de tecnicos>');
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Día operativo y reglas de traspaso
-- ---------------------------------------------------------------------
-- Entre 00:00 y 05:59 sigue siendo el día operativo anterior (turno C).
create or replace function public.fecha_operativa(p_momento timestamptz default now())
returns date
language sql
stable
set search_path = public
as $$
  select ((p_momento at time zone 'America/Tegucigalpa') - interval '6 hours')::date;
$$;

-- Días entre la fecha operativa de quien entrega y la de quien recibe; null = destino no permitido.
--   A        → B, Comodín (mismo día)
--   B        → C (mismo día) · A, Comodín (día siguiente)
--   Comodín  → C (mismo día) · A, Comodín (día siguiente)
--   C        → A, Comodín (día siguiente)
-- Misma regla que src/domain/handover.ts (las pruebas comprueban que coincidan).
create or replace function public.desfase_traspaso(p_origen text, p_destino text)
returns integer
language sql
immutable
as $$
  select case
    when p_origen = 'turnoA' and p_destino in ('turnoB', 'comodin') then 0
    when p_origen in ('turnoB', 'comodin') and p_destino = 'turnoC' then 0
    when p_origen in ('turnoB', 'comodin', 'turnoC') and p_destino in ('turnoA', 'comodin') then 1
  end;
$$;

create or replace function public.describir_turno(p_turno text, p_inicio time, p_fin time)
returns text
language sql
immutable
as $$
  select case p_turno
    when 'turnoA' then 'Turno A'
    when 'turnoB' then 'Turno B'
    when 'turnoC' then 'Turno C'
    else 'Comodín ' || coalesce(to_char(p_inicio, 'HH24:MI') || ' - ' || to_char(p_fin, 'HH24:MI'), '')
  end;
$$;

create or replace function public.describir_estado(p_estado text)
returns text
language sql
immutable
as $$
  select case p_estado
    when 'en_curso' then 'En curso'
    when 'pausado'  then 'Pausado'
    when 'resuelto' then 'Resuelto'
    when 'cerrado'  then 'Cerrado'
    else p_estado
  end;
$$;

-- ---------------------------------------------------------------------
-- 1. Técnicos: el turno ya no es fijo (pasa a la jornada de cada día)
-- ---------------------------------------------------------------------
alter table public.tecnicos add column if not exists activo boolean not null default true;
alter table public.tecnicos alter column turno drop not null;

-- Técnicos creados con el modelo nuevo (sin turno): el nombre no puede repetirse.
create unique index if not exists tecnicos_nombre_unico_v2
  on public.tecnicos (lower(btrim(nombre))) where turno is null;

-- ---------------------------------------------------------------------
-- 2. Perfiles y roles
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  nombre      text        not null check (char_length(btrim(nombre)) > 0),
  rol         text        not null check (rol in ('dispatch', 'tecnico')),
  tecnico_id  uuid        unique references public.tecnicos (id) on delete set null,
  created_at  timestamptz not null default now(),

  -- D4: el dispatch no tiene casos propios
  constraint dispatch_sin_tecnico check (rol = 'tecnico' or tecnico_id is null)
);

comment on table public.perfiles is 'Rol de cada usuario. Se administra solo por SQL. Un técnico se enlaza a su fila de tecnicos.';

create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.perfiles where id = auth.uid();
$$;

create or replace function public.es_dispatch()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.mi_rol() = 'dispatch', false);
$$;

create or replace function public.mi_tecnico_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tecnico_id from public.perfiles where id = auth.uid() and rol = 'tecnico';
$$;

alter table public.perfiles enable row level security;

drop policy if exists "perfiles_leer" on public.perfiles;
create policy "perfiles_leer"
  on public.perfiles for select
  to authenticated
  using (id = auth.uid() or public.es_dispatch());

-- ---------------------------------------------------------------------
-- 3. Jornadas: turno, horario de comodín y almuerzo de cada técnico en cada día operativo
-- ---------------------------------------------------------------------
create table if not exists public.jornadas (
  id               uuid        primary key default gen_random_uuid(),
  fecha_operativa  date        not null,
  tecnico_id       uuid        not null references public.tecnicos (id) on delete cascade,
  turno            text        not null check (turno in ('turnoA', 'turnoB', 'turnoC', 'comodin')),
  horario_inicio   time,
  horario_fin      time,
  almuerzo_inicio  time,
  almuerzo_fin     time,
  created_at       timestamptz not null default now(),

  constraint jornada_unica_por_dia unique (fecha_operativa, tecnico_id),

  -- D7: el comodín usa uno de los horarios fijos; los demás turnos no llevan horario propio
  constraint jornada_horario_comodin check (
    (turno = 'comodin' and (horario_inicio, horario_fin) in (
       ('06:00'::time, '16:00'::time), ('07:00'::time, '17:00'::time), ('08:00'::time, '18:00'::time)))
    or (turno <> 'comodin' and horario_inicio is null and horario_fin is null)
  ),

  constraint jornada_almuerzo_completo check ((almuerzo_inicio is null) = (almuerzo_fin is null))
);

create index if not exists jornadas_fecha_idx on public.jornadas (fecha_operativa);

comment on table public.jornadas is 'Planificación (semanal) del dispatch: el turno de cada técnico en cada día operativo.';

alter table public.jornadas enable row level security;

drop policy if exists "jornadas_leer"            on public.jornadas;
drop policy if exists "jornadas_dispatch_crear"  on public.jornadas;
drop policy if exists "jornadas_dispatch_editar" on public.jornadas;
drop policy if exists "jornadas_dispatch_borrar" on public.jornadas;

create policy "jornadas_leer"            on public.jornadas for select to authenticated using (true);
create policy "jornadas_dispatch_crear"  on public.jornadas for insert to authenticated with check (public.es_dispatch());
create policy "jornadas_dispatch_editar" on public.jornadas for update to authenticated using (public.es_dispatch()) with check (public.es_dispatch());
create policy "jornadas_dispatch_borrar" on public.jornadas for delete to authenticated using (public.es_dispatch());

create or replace function public.bitacora_jornadas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  select nombre into v_nombre from public.tecnicos where id = coalesce(new.tecnico_id, old.tecnico_id);

  if tg_op = 'INSERT' then
    perform public.registrar_bitacora('jornada_planificada', null, v_nombre,
      to_char(new.fecha_operativa, 'YYYY-MM-DD') || ' · ' || public.describir_turno(new.turno, new.horario_inicio, new.horario_fin));
  elsif tg_op = 'UPDATE' then
    if (new.turno, new.horario_inicio, new.horario_fin, new.almuerzo_inicio, new.almuerzo_fin)
       is distinct from (old.turno, old.horario_inicio, old.horario_fin, old.almuerzo_inicio, old.almuerzo_fin) then
      perform public.registrar_bitacora('jornada_modificada', null, v_nombre,
        to_char(new.fecha_operativa, 'YYYY-MM-DD') || ' · ' || public.describir_turno(new.turno, new.horario_inicio, new.horario_fin)
        || coalesce(' · almuerzo ' || to_char(new.almuerzo_inicio, 'HH24:MI') || ' - ' || to_char(new.almuerzo_fin, 'HH24:MI'), ''));
    end if;
  else
    perform public.registrar_bitacora('jornada_eliminada', null, v_nombre, to_char(old.fecha_operativa, 'YYYY-MM-DD'));
  end if;
  return null;
end;
$$;

drop trigger if exists bitacora_jornadas_trg on public.jornadas;
create trigger bitacora_jornadas_trg
  after insert or update or delete on public.jornadas
  for each row execute function public.bitacora_jornadas();

-- ---------------------------------------------------------------------
-- 4. Casos persistentes (nunca se borran: se cierran) e historial de responsables
-- ---------------------------------------------------------------------
create table if not exists public.casos (
  id                        uuid        primary key default gen_random_uuid(),
  codigo                    text        not null check (char_length(btrim(codigo)) > 0),
  cliente                   text,
  area                      text,
  descripcion               text,
  nota                      text,
  estado                    text        not null default 'en_curso'
                                        check (estado in ('en_curso', 'pausado', 'resuelto', 'cerrado')),
  etiqueta                  text        check (etiqueta is null or char_length(etiqueta) <= 40),
  tecnico_actual_id         uuid        references public.tecnicos (id) on delete set null,
  ultima_actualizacion      text        check (ultima_actualizacion is null or char_length(ultima_actualizacion) <= 500),
  ultima_actualizacion_en   timestamptz,
  ultima_actualizacion_por  text,
  creado_en                 timestamptz not null default now(),
  creado_por                text        not null default coalesce(auth.jwt() ->> 'email', 'sistema'),
  cerrado_en                timestamptz
);

-- Un código de caso existe una sola vez en todo el historial.
create unique index if not exists casos_codigo_unico on public.casos (codigo);
create index if not exists casos_tecnico_actual_idx on public.casos (tecnico_actual_id) where estado <> 'cerrado';

comment on table public.casos is 'Todos los casos alguna vez creados. Responsable actual = tecnico_actual_id; historial en caso_responsables.';
comment on column public.casos.ultima_actualizacion is 'Texto corto que el técnico escribe; la base guarda quién y cuándo.';

create table if not exists public.caso_responsables (
  id               uuid        primary key default gen_random_uuid(),
  caso_id          uuid        not null references public.casos (id) on delete cascade,
  tecnico_id       uuid        references public.tecnicos (id) on delete set null,
  tecnico_nombre   text        not null,   -- se conserva aunque el técnico se elimine
  fecha_operativa  date        not null,
  origen           text        not null check (origen in ('dispatch', 'reasignacion', 'traspaso', 'reapertura', 'migracion')),
  desde            timestamptz not null default clock_timestamp(),
  hasta            timestamptz,
  asignado_por     text        not null default 'sistema'
);

-- Como máximo un responsable abierto por caso.
create unique index if not exists caso_responsables_abierto_unico on public.caso_responsables (caso_id) where hasta is null;
create index if not exists caso_responsables_fecha_idx on public.caso_responsables (fecha_operativa, tecnico_id);
create index if not exists caso_responsables_tecnico_idx on public.caso_responsables (tecnico_id);

comment on table public.caso_responsables is 'Quién llevó cada caso, desde/hasta cuándo y en qué día operativo. La escriben los triggers.';

-- Antes de guardar: normaliza el código, marca quién/cuándo actualizó y protege los datos del caso.
-- NO es security definer a propósito: current_user debe ser el de quien llama.
create or replace function public.casos_antes_de_guardar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.codigo := upper(btrim(new.codigo));

  if tg_op = 'UPDATE' then
    -- Un técnico (desde la app) solo puede cambiar estado, etiqueta, nota y última actualización de SUS casos
    -- (las políticas RLS ya limitan a sus casos). El traspaso pasa por enviar_traspaso(), que no es 'authenticated'.
    if current_user = 'authenticated' and not public.es_dispatch() then
      if (new.codigo, new.cliente, new.area, new.descripcion, new.tecnico_actual_id, new.creado_en, new.creado_por)
         is distinct from
         (old.codigo, old.cliente, old.area, old.descripcion, old.tecnico_actual_id, old.creado_en, old.creado_por) then
        raise exception 'Solo el dispatch puede cambiar los datos o el responsable de un caso.' using errcode = '42501';
      end if;
    end if;

    if new.ultima_actualizacion is distinct from old.ultima_actualizacion then
      new.ultima_actualizacion_en  := clock_timestamp();
      new.ultima_actualizacion_por := coalesce(auth.jwt() ->> 'email', 'sistema');
    else
      new.ultima_actualizacion_en  := old.ultima_actualizacion_en;
      new.ultima_actualizacion_por := old.ultima_actualizacion_por;
    end if;

    if new.estado = 'cerrado' and old.estado <> 'cerrado' then
      new.cerrado_en := clock_timestamp();
    elsif new.estado <> 'cerrado' then
      new.cerrado_en := null;
    else
      new.cerrado_en := old.cerrado_en;
    end if;
  else
    if new.ultima_actualizacion is not null then
      new.ultima_actualizacion_en  := clock_timestamp();
      new.ultima_actualizacion_por := coalesce(auth.jwt() ->> 'email', 'sistema');
    end if;
    new.cerrado_en := case when new.estado = 'cerrado' then clock_timestamp() end;
  end if;

  return new;
end;
$$;

drop trigger if exists casos_antes_de_guardar_trg on public.casos;
create trigger casos_antes_de_guardar_trg
  before insert or update on public.casos
  for each row execute function public.casos_antes_de_guardar();

-- ---------------------------------------------------------------------
-- 5. Notificaciones (las crea la base de datos al asignar/traspasar un caso)
-- ---------------------------------------------------------------------
create table if not exists public.notificaciones (
  id          uuid        primary key default gen_random_uuid(),
  tecnico_id  uuid        not null references public.tecnicos (id) on delete cascade,
  tipo        text        not null check (tipo in ('asignado', 'reasignado', 'traspaso')),
  caso_id     uuid        not null references public.casos (id) on delete cascade,
  detalle     text,
  leida       boolean     not null default false,
  creado_en   timestamptz not null default clock_timestamp()
);

create index if not exists notificaciones_tecnico_idx on public.notificaciones (tecnico_id, creado_en desc);

alter table public.notificaciones enable row level security;

drop policy if exists "notificaciones_leer_mias"    on public.notificaciones;
drop policy if exists "notificaciones_marcar_mias"  on public.notificaciones;

create policy "notificaciones_leer_mias"
  on public.notificaciones for select to authenticated
  using (tecnico_id = public.mi_tecnico_id());

create policy "notificaciones_marcar_mias"
  on public.notificaciones for update to authenticated
  using (tecnico_id = public.mi_tecnico_id())
  with check (tecnico_id = public.mi_tecnico_id());

-- Desde la app solo se puede cambiar "leida".
revoke insert, update, delete on public.notificaciones from anon, authenticated;
grant update (leida) on public.notificaciones to authenticated;

-- Después de guardar un caso: historial de responsables, notificaciones y bitácora.
-- El origen y la fecha operativa del nuevo responsable pueden venir de la transacción
-- (app.origen / app.fecha_operativa, los fija enviar_traspaso y la migración).
create or replace function public.casos_despues_de_guardar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen   text := nullif(current_setting('app.origen', true), '');
  v_fecha    date := coalesce(nullif(current_setting('app.fecha_operativa', true), '')::date, public.fecha_operativa());
  v_usuario  text := coalesce(auth.jwt() ->> 'email', 'sistema');
  v_nuevo    text;
  v_previo   text;
  v_abrir    boolean;
begin
  select nombre into v_nuevo from public.tecnicos where id = new.tecnico_actual_id;

  if tg_op = 'INSERT' then
    v_origen := coalesce(v_origen, 'dispatch');
    v_abrir  := new.tecnico_actual_id is not null and new.estado <> 'cerrado';
    if v_origen <> 'migracion' then
      perform public.registrar_bitacora('caso_creado', new.codigo, v_nuevo, new.descripcion);
    end if;
  else
    select nombre into v_previo from public.tecnicos where id = old.tecnico_actual_id;
    v_origen := coalesce(v_origen,
      case when old.estado = 'cerrado' and new.estado <> 'cerrado' then 'reapertura' else 'reasignacion' end);
    v_abrir := new.tecnico_actual_id is not null and new.estado <> 'cerrado'
               and (new.tecnico_actual_id is distinct from old.tecnico_actual_id or old.estado = 'cerrado');

    -- Cierra el responsable vigente si cambia de manos o el caso se cierra
    if new.tecnico_actual_id is distinct from old.tecnico_actual_id
       or (new.estado = 'cerrado' and old.estado <> 'cerrado') then
      update public.caso_responsables set hasta = clock_timestamp() where caso_id = new.id and hasta is null;
    end if;

    if new.estado is distinct from old.estado then
      perform public.registrar_bitacora('estado_cambiado', new.codigo, v_nuevo,
        public.describir_estado(old.estado) || ' → ' || public.describir_estado(new.estado));
    end if;

    if new.etiqueta is distinct from old.etiqueta then
      perform public.registrar_bitacora('etiqueta_cambiada', new.codigo, v_nuevo, coalesce(new.etiqueta, 'Sin etiqueta'));
    end if;

    if new.ultima_actualizacion is distinct from old.ultima_actualizacion and new.ultima_actualizacion is not null then
      perform public.registrar_bitacora('ultima_actualizacion', new.codigo, v_nuevo, new.ultima_actualizacion);
    end if;

    if new.tecnico_actual_id is null and old.tecnico_actual_id is not null then
      perform public.registrar_bitacora('caso_sin_asignar', new.codigo, v_previo, 'Quitado a ' || coalesce(v_previo, '?'));
    elsif v_abrir and v_origen <> 'reapertura' then
      perform public.registrar_bitacora(
        case v_origen when 'traspaso' then 'caso_traspasado' else 'caso_reasignado' end,
        new.codigo, v_nuevo, 'De ' || coalesce(v_previo, 'sin asignar') || ' a ' || coalesce(v_nuevo, '?'));
    end if;
  end if;

  if v_abrir then
    insert into public.caso_responsables (caso_id, tecnico_id, tecnico_nombre, fecha_operativa, origen, asignado_por)
    values (new.id, new.tecnico_actual_id, coalesce(v_nuevo, '?'), v_fecha, v_origen, v_usuario);

    if v_origen <> 'migracion' then
      insert into public.notificaciones (tecnico_id, tipo, caso_id, detalle)
      values (new.tecnico_actual_id,
              case v_origen when 'traspaso' then 'traspaso' when 'dispatch' then 'asignado' else 'reasignado' end,
              new.id, new.codigo);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists casos_despues_de_guardar_trg on public.casos;
create trigger casos_despues_de_guardar_trg
  after insert or update on public.casos
  for each row execute function public.casos_despues_de_guardar();

alter table public.casos             enable row level security;
alter table public.caso_responsables enable row level security;

drop policy if exists "casos_leer"               on public.casos;
drop policy if exists "casos_dispatch_crear"     on public.casos;
drop policy if exists "casos_editar"             on public.casos;
drop policy if exists "responsables_leer"        on public.caso_responsables;

-- Todos los usuarios ven todos los casos (tablero del día y búsqueda global).
create policy "casos_leer" on public.casos for select to authenticated using (true);
create policy "casos_dispatch_crear" on public.casos for insert to authenticated with check (public.es_dispatch());
-- El dispatch edita cualquiera; un técnico, solo los suyos (el trigger limita qué columnas).
create policy "casos_editar" on public.casos for update to authenticated
  using (public.es_dispatch() or tecnico_actual_id = public.mi_tecnico_id())
  with check (public.es_dispatch() or tecnico_actual_id = public.mi_tecnico_id());
-- Sin política de borrado: un caso nunca se elimina, se cierra.

create policy "responsables_leer" on public.caso_responsables for select to authenticated using (true);
revoke insert, update, delete on public.caso_responsables from anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Traspasos
-- ---------------------------------------------------------------------
create table if not exists public.traspasos (
  id               uuid        primary key default gen_random_uuid(),
  de_tecnico_id    uuid        not null references public.tecnicos (id) on delete cascade,
  fecha_operativa  date        not null,
  turno_origen     text        check (turno_origen in ('turnoA', 'turnoB', 'turnoC', 'comodin')),
  estado           text        not null default 'borrador' check (estado in ('borrador', 'enviado')),
  creado_en        timestamptz not null default now(),
  enviado_en       timestamptz,
  enviado_por      text,

  constraint traspaso_unico_por_dia unique (de_tecnico_id, fecha_operativa)
);

create table if not exists public.traspaso_items (
  id                    uuid  primary key default gen_random_uuid(),
  traspaso_id           uuid  not null references public.traspasos (id) on delete cascade,
  caso_id               uuid  not null references public.casos (id) on delete cascade,
  para_tecnico_id       uuid  references public.tecnicos (id) on delete set null,
  estado                text  not null default 'en_curso' check (estado in ('en_curso', 'pausado', 'resuelto', 'cerrado')),
  etiqueta              text  check (etiqueta is null or char_length(etiqueta) <= 40),
  nota_personalizada    text  check (nota_personalizada is null or char_length(nota_personalizada) <= 500),
  ultima_actualizacion  text  check (ultima_actualizacion is null or char_length(ultima_actualizacion) <= 500),

  constraint traspaso_item_unico unique (traspaso_id, caso_id)
);

create index if not exists traspaso_items_para_idx on public.traspaso_items (para_tecnico_id);

comment on table public.traspasos is 'Entrega de casos al cerrar turno. Se arma como borrador y se envía con enviar_traspaso().';

-- Funciones de apoyo para las políticas (security definer: evitan recursión entre políticas).
create or replace function public.es_mi_traspaso(p_traspaso uuid, p_solo_borrador boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.traspasos
    where id = p_traspaso and de_tecnico_id = public.mi_tecnico_id()
      and (not p_solo_borrador or estado = 'borrador'));
$$;

create or replace function public.recibi_de_traspaso(p_traspaso uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.traspaso_items i join public.traspasos t on t.id = i.traspaso_id
    where t.id = p_traspaso and t.estado = 'enviado' and i.para_tecnico_id = public.mi_tecnico_id());
$$;

alter table public.traspasos      enable row level security;
alter table public.traspaso_items enable row level security;

drop policy if exists "traspasos_leer"          on public.traspasos;
drop policy if exists "traspasos_crear"         on public.traspasos;
drop policy if exists "traspasos_editar"        on public.traspasos;
drop policy if exists "traspasos_borrar"        on public.traspasos;
drop policy if exists "traspaso_items_leer"     on public.traspaso_items;
drop policy if exists "traspaso_items_escribir" on public.traspaso_items;

create policy "traspasos_leer" on public.traspasos for select to authenticated
  using (public.es_dispatch() or de_tecnico_id = public.mi_tecnico_id() or public.recibi_de_traspaso(id));
-- Solo el propio técnico arma su borrador; pasar a "enviado" solo lo hace enviar_traspaso().
create policy "traspasos_crear" on public.traspasos for insert to authenticated
  with check (de_tecnico_id = public.mi_tecnico_id() and estado = 'borrador');
create policy "traspasos_editar" on public.traspasos for update to authenticated
  using (de_tecnico_id = public.mi_tecnico_id() and estado = 'borrador')
  with check (de_tecnico_id = public.mi_tecnico_id() and estado = 'borrador');
create policy "traspasos_borrar" on public.traspasos for delete to authenticated
  using (de_tecnico_id = public.mi_tecnico_id() and estado = 'borrador');

create policy "traspaso_items_leer" on public.traspaso_items for select to authenticated
  using (public.es_dispatch() or public.es_mi_traspaso(traspaso_id, false)
         or (para_tecnico_id = public.mi_tecnico_id() and public.recibi_de_traspaso(traspaso_id)));
create policy "traspaso_items_escribir" on public.traspaso_items for all to authenticated
  using (public.es_mi_traspaso(traspaso_id, true))
  with check (public.es_mi_traspaso(traspaso_id, true));

-- Envía el traspaso en UNA transacción. Reglas (D2, D6):
--   · todos los casos no cerrados del técnico deben estar en el traspaso (su carga queda en 0);
--   · cada caso no cerrado necesita receptor y última actualización;
--   · el receptor debe estar planificado en un turno permitido para el turno de quien entrega.
-- Devuelve cuántos casos cambiaron de manos.
create or replace function public.enviar_traspaso(p_traspaso uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t          public.traspasos%rowtype;
  v_origen     text;
  v_faltantes  integer;
  v_item       record;
  v_destino    record;
  v_movidos    integer := 0;
begin
  select * into v_t from public.traspasos where id = p_traspaso for update;
  if not found or v_t.de_tecnico_id is distinct from public.mi_tecnico_id() then
    raise exception 'Traspaso no encontrado.' using errcode = '42501';
  end if;
  if v_t.estado <> 'borrador' then
    raise exception 'Este traspaso ya fue enviado.';
  end if;

  select turno into v_origen from public.jornadas
  where tecnico_id = v_t.de_tecnico_id and fecha_operativa = v_t.fecha_operativa;
  if v_origen is null then
    raise exception 'No tienes jornada planificada el %: pide al dispatch que te planifique.', v_t.fecha_operativa;
  end if;

  -- Casos propios no cerrados que no están en el traspaso
  select count(*) into v_faltantes
  from public.casos c
  where c.tecnico_actual_id = v_t.de_tecnico_id and c.estado <> 'cerrado'
    and not exists (select 1 from public.traspaso_items i where i.traspaso_id = p_traspaso and i.caso_id = c.id);
  if v_faltantes > 0 then
    raise exception 'Quedan % caso(s) sin incluir en el traspaso: tu carga debe quedar en 0.', v_faltantes;
  end if;

  -- Ítems de casos ajenos
  if exists (select 1 from public.traspaso_items i join public.casos c on c.id = i.caso_id
             where i.traspaso_id = p_traspaso and c.tecnico_actual_id is distinct from v_t.de_tecnico_id) then
    raise exception 'El traspaso incluye casos que no son tuyos.';
  end if;

  for v_item in
    select i.*, c.codigo from public.traspaso_items i join public.casos c on c.id = i.caso_id
    where i.traspaso_id = p_traspaso
    order by c.codigo
  loop
    if v_item.estado = 'cerrado' then
      perform set_config('app.origen', '', true);
      update public.casos
         set estado = 'cerrado', etiqueta = v_item.etiqueta,
             ultima_actualizacion = coalesce(nullif(btrim(v_item.ultima_actualizacion), ''), ultima_actualizacion)
       where id = v_item.caso_id;
      continue;
    end if;

    if v_item.para_tecnico_id is null then
      raise exception 'El caso % no tiene a quién traspasarse.', v_item.codigo;
    end if;
    if v_item.para_tecnico_id = v_t.de_tecnico_id then
      raise exception 'El caso % no puede traspasarse a ti mismo.', v_item.codigo;
    end if;
    select j.fecha_operativa, j.turno into v_destino
    from public.jornadas j
    where j.tecnico_id = v_item.para_tecnico_id
      and j.fecha_operativa in (v_t.fecha_operativa, v_t.fecha_operativa + 1)
      and public.desfase_traspaso(v_origen, j.turno) = j.fecha_operativa - v_t.fecha_operativa
    order by j.fecha_operativa
    limit 1;
    if not found then
      raise exception 'El receptor del caso % no está planificado en un turno que pueda recibir de %.',
        v_item.codigo, public.describir_turno(v_origen, null, null);
    end if;

    if nullif(btrim(coalesce(v_item.ultima_actualizacion, '')), '') is null then
      raise exception 'El caso % necesita su última actualización.', v_item.codigo;
    end if;

    perform set_config('app.origen', 'traspaso', true);
    perform set_config('app.fecha_operativa', v_destino.fecha_operativa::text, true);
    update public.casos
       set tecnico_actual_id = v_item.para_tecnico_id,
           estado = v_item.estado,
           etiqueta = v_item.etiqueta,
           ultima_actualizacion = btrim(v_item.ultima_actualizacion)
     where id = v_item.caso_id;
    v_movidos := v_movidos + 1;
  end loop;

  perform set_config('app.origen', '', true);
  perform set_config('app.fecha_operativa', '', true);

  update public.traspasos
     set estado = 'enviado', turno_origen = v_origen, enviado_en = now(),
         enviado_por = coalesce(auth.jwt() ->> 'email', 'sistema')
   where id = p_traspaso;

  perform public.registrar_bitacora('traspaso_enviado', null,
    (select nombre from public.tecnicos where id = v_t.de_tecnico_id),
    v_movidos || ' caso(s) traspasado(s) · ' || public.describir_turno(v_origen, null, null));

  return v_movidos;
end;
$$;

revoke all on function public.enviar_traspaso(uuid) from public, anon;
grant execute on function public.enviar_traspaso(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Snapshot del día operativo (misma forma que lee la pestaña Historial, más estado y etiqueta)
--    Cada caso aparece con quien lo tuvo por última vez ese día.
-- ---------------------------------------------------------------------
create or replace function public.generar_snapshot_operativo(p_fecha date default public.fecha_operativa())
returns void
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
        'turno',          j.turno,
        'horarioInicio',  to_char(j.horario_inicio,  'HH24:MI'),
        'horarioFin',     to_char(j.horario_fin,     'HH24:MI'),
        'almuerzoInicio', to_char(j.almuerzo_inicio, 'HH24:MI'),
        'almuerzoFin',    to_char(j.almuerzo_fin,    'HH24:MI'),
        'incidentes', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'id', c.id, 'codigo', c.codigo, 'nota', c.nota, 'tecnicoId', t.id, 'creadoEn', r.desde,
                     'estado', c.estado, 'etiqueta', c.etiqueta, 'ultimaActualizacion', c.ultima_actualizacion
                   ) order by r.desde)
          from public.caso_responsables r
          join public.casos c on c.id = r.caso_id
          where r.tecnico_id = t.id and r.fecha_operativa = p_fecha
            and not exists (
              select 1 from public.caso_responsables r2
              where r2.caso_id = r.caso_id and r2.fecha_operativa = p_fecha and r2.desde > r.desde)
        ), '[]'::jsonb)
      ) order by t.nombre
    ), '[]'::jsonb)
  from public.jornadas j
  join public.tecnicos t on t.id = j.tecnico_id
  where j.fecha_operativa = p_fecha
  on conflict (fecha) do update
    set datos_panel = excluded.datos_panel, created_at = now();
end;
$$;

revoke all on function public.generar_snapshot_operativo(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Tiempo real
-- ---------------------------------------------------------------------
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['jornadas', 'casos', 'caso_responsables', 'notificaciones', 'traspasos'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabla) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabla);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Copia de los datos actuales (idempotente: solo agrega lo que falte)
-- ---------------------------------------------------------------------
-- El turno fijo de hoy pasa a ser la jornada de hoy. Los comodines con un horario fuera de la
-- lista fija (D7) no se copian: el dispatch debe planificarlos de nuevo.
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

-- Los incidentes del tablero pasan a ser casos "en curso" con su responsable de hoy.
select set_config('app.origen', 'migracion', true);
insert into public.casos (codigo, nota, estado, tecnico_actual_id, creado_en, creado_por)
select i.codigo, i.nota, 'en_curso', i.tecnico_id, i.created_at, 'migracion'
from public.incidentes i
on conflict (codigo) do nothing;
select set_config('app.origen', '', true);

commit;
