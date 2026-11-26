-- =====================================================================
-- Panel NOC · v2.8 · Rendimiento a un año de uso
-- Requiere 04 a 18. Idempotente: se puede ejecutar más de una vez. No cambia lo que ve nadie.
--
-- Medido con datos sintéticos (36.500 casos = 1 año a 100/día) antes de este cambio, `buscar_casos` tardaba entre
-- 2 y 6 s en el plan Free de Supabase, y en dos años podía pasar el límite de 8 s de la API. Motivos y arreglos:
--   1. Las políticas RLS llamaban a tiene_perfil(), es_dispatch()… UNA VEZ POR FILA. Envueltas en (select …)
--      Postgres las evalúa una vez por consulta (aviso `auth_rls_initplan` de Supabase).
--   2. La búsqueda recorría toda la tabla con ILIKE en 9 columnas. Ahora usa índices de trigramas (pg_trgm):
--      uno sobre el texto del caso y otro sobre el nombre de cada responsable del historial.
--   3. Índices para las claves foráneas que Supabase señala sin índice (aviso `unindexed_foreign_keys`).
--   4. pg_cron guarda cada ejecución para siempre (~865 filas/día, ~60 MB/año): se borran las de más de 7 días
--      (bloque final, solo Supabase).
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

begin;

-- Con `public` primero, las políticas se leen sin el prefijo "public." (lo que espera la expresión regular)
set local search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. Políticas RLS: funciones sin argumentos una vez por consulta
-- ---------------------------------------------------------------------
-- Reescribe TODAS las políticas de `public`: cada llamada a una de estas funciones (o a auth.uid()) que no esté ya
-- envuelta pasa a ser `(select …)`. El resultado es el mismo: son funciones estables que no dependen de la fila.
-- "(?<!SELECT )" no toca lo ya envuelto, así que se puede ejecutar dos veces. Una migración futura que vuelva a
-- crear una política debe escribirla ya con (select …) o volver a ejecutar este bloque.
create or replace function public.envolver_en_select(p_expr text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           regexp_replace(p_expr,
             '(?<!SELECT )(public\.)?\m(es_dispatch|es_coordinador|tiene_perfil|mi_tecnico_id|mi_rol|fecha_operativa)\(\)',
             '(select public.\2())', 'g'),
           '(?<!SELECT )\mauth\.uid\(\)', '(select auth.uid())', 'g');
$$;
revoke all on function public.envolver_en_select(text) from public, anon, authenticated;

do $$
declare
  p record;
  v_qual text;
  v_check text;
begin
  for p in select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    v_qual  := public.envolver_en_select(p.qual);
    v_check := public.envolver_en_select(p.with_check);
    if v_qual is distinct from p.qual then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, v_qual);
    end if;
    if v_check is distinct from p.with_check then
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, v_check);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Búsqueda con índices de trigramas
-- ---------------------------------------------------------------------
-- Texto buscable de un caso: los mismos campos que antes, separados por un salto de línea (nadie lo escribe en el
-- buscador, así que una búsqueda no puede "unir" dos campos).
create or replace function public.texto_de_busqueda_caso(
  p_codigo text, p_cliente text, p_area text, p_nota text, p_descripcion text, p_etiqueta text, p_ultima text
)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(p_codigo, '') || chr(10) || coalesce(p_cliente, '') || chr(10) || coalesce(p_area, '') || chr(10) ||
         coalesce(p_nota, '') || chr(10) || coalesce(p_descripcion, '') || chr(10) || coalesce(p_etiqueta, '') || chr(10) ||
         coalesce(p_ultima, '');
$$;

create index if not exists casos_busqueda_trgm on public.casos using gin (
  public.texto_de_busqueda_caso(codigo, cliente, area, nota, descripcion, etiqueta, ultima_actualizacion) extensions.gin_trgm_ops
);
create index if not exists caso_responsables_nombre_trgm on public.caso_responsables using gin (tecnico_nombre extensions.gin_trgm_ops);

-- Patrón ILIKE de un término: "%término%" con %, _ y \ como literales. Vacío → null (no coincide con nada).
create or replace function public.patron_de_busqueda(p_termino text)
returns text
language sql
immutable
parallel safe
as $$
  select case when btrim(coalesce(p_termino, '')) = '' then null
              else '%' || replace(replace(replace(btrim(p_termino), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
$$;

-- Ids de los casos que coinciden con un término (en el texto del caso, en el técnico actual o en cualquier
-- responsable del historial). SECURITY DEFINER a propósito: con RLS activa, Postgres no usa índices para ILIKE
-- (el operador no es "leakproof") y recorría la tabla entera. Solo devuelve ids, y nada a quien no tiene perfil
-- (la misma regla de lectura de casos, D32); buscar_casos lee después los casos con RLS.
create or replace function public.casos_que_coinciden(p_termino text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.casos c
  where public.tiene_perfil()
    and public.texto_de_busqueda_caso(c.codigo, c.cliente, c.area, c.nota, c.descripcion, c.etiqueta, c.ultima_actualizacion)
        ilike public.patron_de_busqueda(p_termino)
  union
  select r.caso_id from public.caso_responsables r
  where public.tiene_perfil() and r.tecnico_nombre ilike public.patron_de_busqueda(p_termino)
  union
  select c.id from public.casos c
  where public.tiene_perfil()
    and c.tecnico_actual_id in (select tec.id from public.tecnicos tec where tec.nombre ilike public.patron_de_busqueda(p_termino));
$$;
revoke all on function public.casos_que_coinciden(text) from public, anon;
grant execute on function public.casos_que_coinciden(text) to authenticated;

-- Igual que la 08 (mismos campos, mismo orden y mismo límite), pero los casos salen de casos_que_coinciden
-- (con índices). Sigue siendo security invoker: los casos se leen con RLS.
create or replace function public.buscar_casos(p_termino text, p_limite integer default 50)
returns table (
  id uuid, codigo text, cliente text, area text, nota text, descripcion text, estado text, etiqueta text,
  ultima_actualizacion text, ultima_actualizacion_en timestamptz, ultima_actualizacion_por text,
  actividad_tecnico_en timestamptz, tecnico_actual_id uuid, tecnico_actual text,
  creado_en timestamptz, creado_por text, cerrado_en timestamptz, recordatorio_fecha date, recordatorio_texto text
)
language sql
stable
set search_path = public
as $$
  select c.id, c.codigo, c.cliente, c.area, c.nota, c.descripcion, c.estado, c.etiqueta,
         c.ultima_actualizacion, c.ultima_actualizacion_en, c.ultima_actualizacion_por,
         c.actividad_tecnico_en, c.tecnico_actual_id, tec.nombre,
         c.creado_en, c.creado_por, c.cerrado_en, c.recordatorio_fecha, c.recordatorio_texto
  from public.casos_que_coinciden(p_termino) m (id)
  join public.casos c on c.id = m.id
  left join public.tecnicos tec on tec.id = c.tecnico_actual_id
  order by (c.estado = 'cerrado'), coalesce(c.actividad_tecnico_en, c.ultima_actualizacion_en, c.creado_en) desc, c.codigo
  limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;
revoke all on function public.buscar_casos(text, integer) from public, anon;
grant execute on function public.buscar_casos(text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Índices de claves foráneas
-- ---------------------------------------------------------------------
create index if not exists caso_responsables_caso_idx              on public.caso_responsables (caso_id);
create index if not exists traspaso_items_caso_idx                 on public.traspaso_items (caso_id);
create index if not exists notificaciones_caso_idx                 on public.notificaciones (caso_id);
create index if not exists jornadas_tecnico_idx                    on public.jornadas (tecnico_id);
create index if not exists alertas_coordinacion_tecnico_idx        on public.alertas_coordinacion (tecnico_id);
create index if not exists avisos_planificacion_autor_idx          on public.avisos_planificacion (autor_id);
create index if not exists ronda_estado_ultimo_tecnico_idx         on public.ronda_estado (ultimo_tecnico_id);
create index if not exists solicitudes_planificacion_solicitante_idx on public.solicitudes_planificacion (solicitante_id);
create index if not exists solicitudes_planificacion_resuelta_idx  on public.solicitudes_planificacion (resuelta_por);

analyze public.casos;
analyze public.caso_responsables;

commit;

-- =====================================================================
-- 4. Limpiar el registro de pg_cron todos los días (solo en Supabase)
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'limpiar-registro-cron';

-- 12:17 UTC = 06:17 Honduras, después del snapshot de las 05:59
select cron.schedule(
  'limpiar-registro-cron',
  '17 12 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $$
);
