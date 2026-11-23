-- =====================================================================
-- 13 · v2 · Filtros y tipo de caso (fase 13 · docs/DISENO_V2.md §11.11)
-- Requiere 04–12. Idempotente: se puede ejecutar más de una vez.
--
--  - tipo_de_caso(codigo) = domain/caseType.ts: '#SR…' o '#INC…' → FRESH · 'SCTASK…' → SCTASK (Tarea) ·
--    'INC…' → INC (Incidente) · lo demás → OTRO. Sirve para consultas de coordinación en el SQL Editor.
--  - La vista tablero_del_dia suma `area` y `tipo` al final, para filtrar el tablero por área y tipo.
-- =====================================================================
begin;

create or replace function public.tipo_de_caso(p_codigo text)
returns text
language sql
immutable
as $$
  select case
    when upper(btrim(coalesce(p_codigo, ''))) like '#SR%'  then 'FRESH'
    when upper(btrim(coalesce(p_codigo, ''))) like '#INC%' then 'FRESH'
    when upper(btrim(coalesce(p_codigo, ''))) like 'SCTASK%' then 'SCTASK'
    when upper(btrim(coalesce(p_codigo, ''))) like 'INC%' then 'INC'
    else 'OTRO'
  end
$$;

grant execute on function public.tipo_de_caso(text) to authenticated;

-- Misma vista de la 11 con dos columnas nuevas al final (una vista solo admite columnas nuevas al final).
create or replace view public.tablero_del_dia
with (security_invoker = true) as
select distinct on (r.caso_id, r.fecha_operativa)
       r.fecha_operativa,
       c.id,
       c.codigo,
       c.cliente,
       c.nota,
       c.estado,
       c.etiqueta,
       r.tecnico_id      as tecnico_asignado_id,
       r.tecnico_nombre  as tecnico_asignado_nombre,
       r.desde           as asignado_en,
       r.origen,
       c.tecnico_actual_id,
       c.creado_en,
       c.area,
       public.tipo_de_caso(c.codigo) as tipo
from public.caso_responsables r
join public.casos c on c.id = r.caso_id
where r.origen = any (public.origenes_del_tablero())
order by r.caso_id, r.fecha_operativa, r.desde desc;

grant select on public.tablero_del_dia to authenticated;
revoke all on public.tablero_del_dia from anon;

commit;
