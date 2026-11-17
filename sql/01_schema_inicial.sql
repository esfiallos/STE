-- =====================================================================
-- Panel NOC · esquema de base de datos (Supabase / PostgreSQL) · v2
-- Ejecutar completo en: Supabase > SQL Editor
-- ATENCIÓN: elimina las tablas anteriores y todos sus datos.
-- Requiere login: solo usuarios autenticados (Supabase Auth) acceden a los datos.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Limpieza del esquema anterior
-- ---------------------------------------------------------------------
drop table if exists public.incidentes           cascade;
drop table if exists public.tecnicos             cascade;
drop table if exists public.tickets_noc          cascade;
drop table if exists public.historial_snapshots  cascade;
drop function if exists public.normalizar_codigo_incidente() cascade;

-- ---------------------------------------------------------------------
-- 2. Técnicos (pertenecen a un turno y guardan su horario de comida)
-- ---------------------------------------------------------------------
create table public.tecnicos (
  id               uuid        primary key default gen_random_uuid(),
  nombre           text        not null check (char_length(trim(nombre)) > 0),
  turno            text        not null check (turno in ('turnoA', 'turnoB', 'turnoC')),
  almuerzo_inicio  time,
  almuerzo_fin     time,
  created_at       timestamptz not null default now(),

  -- el horario de comida se define completo o no se define
  constraint almuerzo_completo
    check ((almuerzo_inicio is null) = (almuerzo_fin is null)),

  -- no puede haber dos técnicos con el mismo nombre en el mismo turno
  constraint tecnico_unico_por_turno unique (turno, nombre)
);

comment on table  public.tecnicos       is 'Técnicos del NOC por turno (A mañana, B tarde, C nocturno).';
comment on column public.tecnicos.turno is 'turnoA | turnoB | turnoC';

-- ---------------------------------------------------------------------
-- 3. Incidentes asignados (cada INC pertenece a un solo técnico)
-- ---------------------------------------------------------------------
create table public.incidentes (
  id          uuid        primary key default gen_random_uuid(),
  codigo      text        not null check (char_length(trim(codigo)) > 0),
  nota        text,
  tecnico_id  uuid        not null references public.tecnicos (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index incidentes_tecnico_id_idx on public.incidentes (tecnico_id);

-- El código siempre se guarda en mayúsculas y sin espacios en los extremos,
-- así "inc009842 " e "INC009842" son el mismo caso para la base de datos.
create function public.normalizar_codigo_incidente()
returns trigger
language plpgsql
as $$
begin
  new.codigo := upper(btrim(new.codigo));
  return new;
end;
$$;

create trigger incidentes_normalizar_codigo
  before insert or update of codigo on public.incidentes
  for each row execute function public.normalizar_codigo_incidente();

-- Un INC no puede estar en el tablero dos veces (ni con dos técnicos).
-- Reasignar = UPDATE de tecnico_id sobre el mismo registro: eso sí está permitido.
-- Al insertar un INC repetido, Postgres devuelve el error 23505 (unique_violation).
create unique index incidentes_codigo_unico on public.incidentes (codigo);

comment on table public.incidentes is 'Casos activos del tablero. Mover un caso = cambiar tecnico_id. Cerrar un caso = borrarlo.';

-- ---------------------------------------------------------------------
-- 4. Historial de snapshots (uno por día; guardar de nuevo el mismo día lo reemplaza)
-- ---------------------------------------------------------------------
create table public.historial_snapshots (
  id           uuid        primary key default gen_random_uuid(),
  fecha        date        not null unique,   -- el unique permite upsert onConflict: 'fecha'
  datos_panel  jsonb       not null,
  created_at   timestamptz not null default now()
);

comment on table public.historial_snapshots is 'Foto diaria del estado del tablero (técnicos con sus incidentes).';

-- ---------------------------------------------------------------------
-- 5. Tiempo real (Supabase Realtime)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.tecnicos, public.incidentes;

-- ---------------------------------------------------------------------
-- 6. Seguridad (RLS): solo usuarios con sesión iniciada
--    El rol anon (visitante sin login) no tiene ninguna política: no ve ni escribe nada.
-- ---------------------------------------------------------------------
alter table public.tecnicos             enable row level security;
alter table public.incidentes           enable row level security;
alter table public.historial_snapshots  enable row level security;

create policy "tecnicos_usuarios_autenticados"
  on public.tecnicos for all
  to authenticated
  using (true) with check (true);

create policy "incidentes_usuarios_autenticados"
  on public.incidentes for all
  to authenticated
  using (true) with check (true);

create policy "snapshots_leer_autenticados"
  on public.historial_snapshots for select
  to authenticated
  using (true);

create policy "snapshots_guardar_autenticados"
  on public.historial_snapshots for insert
  to authenticated
  with check (true);

create policy "snapshots_actualizar_autenticados"
  on public.historial_snapshots for update
  to authenticated
  using (true) with check (true);

commit;
