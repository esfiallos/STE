-- =====================================================================
-- Panel NOC · migración v6 — diseño v2, fase 4: módulo del técnico (Seguimiento)
--   Requiere 04 y 05. Solo amplía la vista del tablero; no cambia datos.
--
--   casos_abiertos suma al final (una vista solo admite columnas nuevas al final):
--     · origen_responsable: cómo llegó el caso a su responsable actual
--       (dispatch, reasignacion, traspaso, reapertura, migracion) → "Nuevos" vs "Recibidos en traspaso"
--     · ultima_actualizacion_por: quién escribió la última actualización
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

create or replace view public.casos_abiertos
with (security_invoker = true) as
select c.id, c.codigo, c.cliente, c.area, c.descripcion, c.nota, c.estado, c.etiqueta,
       c.tecnico_actual_id, c.ultima_actualizacion, c.ultima_actualizacion_en, c.creado_en,
       r.fecha_operativa as fecha_responsable,
       r.desde           as asignado_en,
       r.origen          as origen_responsable,
       c.ultima_actualizacion_por
from public.casos c
left join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
where c.estado <> 'cerrado';

grant select on public.casos_abiertos to authenticated;
revoke all on public.casos_abiertos from anon;

commit;
