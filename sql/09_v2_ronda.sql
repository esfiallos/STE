-- =====================================================================
-- Panel NOC · migración v9 — diseño v2, fase 7: asignar a la ronda (docs/DISENO_V2.md §10.2, D10)
--   Requiere 04–08. Idempotente: se puede ejecutar más de una vez.
--
--   El dispatch crea un caso y la base lo asigna al SIGUIENTE técnico de la ronda:
--     · candidatos = técnicos activos con jornada hoy que están disponibles ahora (en su horario y fuera
--       de su almuerzo), incluidos los comodines en horario;
--     · orden alfabético (sin acentos ni mayúsculas); se recuerda quién recibió el último caso de la ronda
--       en el turno en curso (A 06–14, B 14–22, C 22–06) y se asigna al siguiente; al final vuelve al primero;
--     · el puntero se reinicia al empezar cada turno. Asignar a un técnico concreto NO mueve el puntero.
--   Misma regla en src/domain/round.ts (una prueba verifica que coincidan).
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Puntero de la ronda: uno por día operativo y turno
-- ---------------------------------------------------------------------
create table if not exists public.ronda_estado (
  fecha_operativa    date        not null,
  turno              text        not null check (turno in ('turnoA', 'turnoB', 'turnoC')),
  ultimo_tecnico_id  uuid        references public.tecnicos (id) on delete set null,
  ultimo_nombre      text,
  actualizado_en     timestamptz not null default now(),
  primary key (fecha_operativa, turno)
);

comment on table public.ronda_estado is 'Quién recibió el último caso asignado por ronda en cada turno (lo escribe asignar_a_ronda).';

alter table public.ronda_estado enable row level security;
drop policy if exists "ronda_leer" on public.ronda_estado;
create policy "ronda_leer" on public.ronda_estado for select to authenticated
  using (public.es_dispatch() or public.es_coordinador());
revoke insert, update, delete on public.ronda_estado from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Reglas: turno en curso, clave de orden y técnicos disponibles
-- ---------------------------------------------------------------------

-- ¿La hora está dentro de [inicio, fin)? Soporta rangos que cruzan la medianoche (= estaDentroDelRango).
create or replace function public.hora_en_rango(p_hora time, p_inicio time, p_fin time)
returns boolean
language sql
immutable
as $$
  select case
    when p_inicio is null or p_fin is null or p_inicio = p_fin then false
    when p_inicio < p_fin then p_hora >= p_inicio and p_hora < p_fin
    else p_hora >= p_inicio or p_hora < p_fin
  end;
$$;

-- Turno A, B o C en curso en un momento (hora de Honduras).
create or replace function public.turno_en_curso(p_ahora timestamptz default now())
returns text
language sql
stable
set search_path = public
as $$
  select case
    when public.hora_en_rango((p_ahora at time zone 'America/Tegucigalpa')::time, '06:00', '14:00') then 'turnoA'
    when public.hora_en_rango((p_ahora at time zone 'America/Tegucigalpa')::time, '14:00', '22:00') then 'turnoB'
    else 'turnoC'
  end;
$$;

-- Clave para ordenar por nombre: minúsculas, sin acentos y con espacios simples (= claveDeRonda en TS).
-- Se compara siempre con collate "C" (byte a byte), igual que en TS, sin depender del idioma de la base.
create or replace function public.clave_de_ronda(p_nombre text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           lower(translate(btrim(coalesce(p_nombre, '')), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
                                                          'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')),
           '\s+', ' ', 'g');
$$;

-- Técnicos que pueden recibir un caso ahora, en el orden de la ronda.
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
          case j.turno when 'turnoA' then time '06:00' when 'turnoB' then time '14:00' when 'turnoC' then time '22:00' else j.horario_inicio end,
          case j.turno when 'turnoA' then time '14:00' when 'turnoB' then time '22:00' when 'turnoC' then time '06:00' else j.horario_fin end)
    and not public.hora_en_rango((p_ahora at time zone 'America/Tegucigalpa')::time, j.almuerzo_inicio, j.almuerzo_fin)
  order by public.clave_de_ronda(t.nombre) collate "C", t.nombre, t.id;
$$;

revoke all on function public.tecnicos_de_la_ronda(timestamptz) from public, anon;
grant execute on function public.tecnicos_de_la_ronda(timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Crear un caso y asignarlo al siguiente de la ronda (una transacción, con el puntero bloqueado)
-- ---------------------------------------------------------------------
drop function if exists public.asignar_a_ronda(text, text);
create function public.asignar_a_ronda(p_codigo text, p_nota text default null)
returns table (caso_id uuid, tecnico_id uuid, tecnico_nombre text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo   text := upper(btrim(coalesce(p_codigo, '')));
  v_fecha    date := public.fecha_operativa();
  v_turno    text := public.turno_en_curso();
  v_ultimo   text;
  v_elegido  record;
  v_caso     uuid;
begin
  if not public.es_dispatch() then
    raise exception 'Solo el dispatch asigna casos.' using errcode = '42501';
  end if;
  if v_codigo = '' then
    raise exception 'Indica el número de incidente.';
  end if;
  if exists (select 1 from public.casos where codigo = v_codigo) then
    raise exception 'El caso % ya existe: asígnalo a un técnico concreto.', v_codigo using errcode = '23505';
  end if;

  insert into public.ronda_estado (fecha_operativa, turno) values (v_fecha, v_turno) on conflict do nothing;
  select public.clave_de_ronda(ultimo_nombre) into v_ultimo
  from public.ronda_estado where fecha_operativa = v_fecha and turno = v_turno
  for update;

  -- El siguiente después del último (por nombre); si no hay, el primero.
  select r.tecnico_id, r.nombre into v_elegido
  from public.tecnicos_de_la_ronda() r
  order by (v_ultimo is not null and r.clave collate "C" <= v_ultimo collate "C"), r.clave collate "C", r.nombre, r.tecnico_id
  limit 1;
  if not found then
    raise exception 'No hay técnicos disponibles ahora para la ronda.';
  end if;

  insert into public.casos (codigo, nota, tecnico_actual_id)
  values (v_codigo, nullif(btrim(coalesce(p_nota, '')), ''), v_elegido.tecnico_id)
  returning id into v_caso;

  update public.ronda_estado
     set ultimo_tecnico_id = v_elegido.tecnico_id, ultimo_nombre = v_elegido.nombre, actualizado_en = now()
   where fecha_operativa = v_fecha and turno = v_turno;

  perform public.registrar_bitacora('asignado_por_ronda', v_codigo, v_elegido.nombre,
    'Ronda ' || public.describir_turno(v_turno, null, null));

  return query select v_caso, v_elegido.tecnico_id, v_elegido.nombre;
end;
$$;

revoke all on function public.asignar_a_ronda(text, text) from public, anon;
grant execute on function public.asignar_a_ronda(text, text) to authenticated;

-- Tiempo real: el "siguiente en la ronda" se actualiza en todos los dispatch.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ronda_estado') then
    alter publication supabase_realtime add table public.ronda_estado;
  end if;
end;
$$;

commit;
