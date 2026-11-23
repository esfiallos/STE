-- =====================================================================
-- Panel NOC · v2.3 · Quedarse un caso para el turno de mañana (traspaso a uno mismo)
-- Requiere 04 a 14. Idempotente: se puede ejecutar más de una vez.
--
-- 1. D31: al cerrar turno, un técnico puede entregarse un caso a sí mismo **para su turno de mañana**, si está
--    planificado mañana en un turno que pueda recibir del suyo (misma regla D6: p. ej. comodín hoy → comodín
--    mañana, B hoy → A mañana). El mismo día, nunca. El caso cambia de día: se cierra el tramo de hoy en
--    caso_responsables y se abre uno nuevo (origen 'traspaso', fecha de mañana). Sin aviso (es suyo).
-- 2. La carga en 0 (D2) cuenta solo los casos de hoy: lo que ya es para un turno futuro (recibido o propio)
--    se entrega cuando cierre ese turno, no impide cerrar el de hoy.
-- Resto de reglas igual que la 12 (D2, D6, D21, recordatorios).
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

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
  v_texto      text;
  v_desc       text;
  v_en         timestamptz;
  v_propio     boolean;
  v_nombre     text;
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

  -- Carga en 0: los casos abiertos de hoy (no los que ya son para un turno futuro)
  select count(*) into v_faltantes
  from public.casos c
  where c.tecnico_actual_id = v_t.de_tecnico_id and c.estado <> 'cerrado'
    and not exists (select 1 from public.traspaso_items i where i.traspaso_id = p_traspaso and i.caso_id = c.id)
    and not exists (select 1 from public.caso_responsables r
                    where r.caso_id = c.id and r.hasta is null and r.fecha_operativa > v_t.fecha_operativa);
  if v_faltantes > 0 then
    raise exception 'Quedan % caso(s) sin incluir en el traspaso: tu carga debe quedar en 0.', v_faltantes;
  end if;

  if exists (select 1 from public.traspaso_items i join public.casos c on c.id = i.caso_id
             where i.traspaso_id = p_traspaso and c.tecnico_actual_id is distinct from v_t.de_tecnico_id) then
    raise exception 'El traspaso incluye casos que no son tuyos.';
  end if;

  select nombre into v_nombre from public.tecnicos where id = v_t.de_tecnico_id;

  for v_item in
    select i.*, c.codigo, c.descripcion as descripcion_caso
    from public.traspaso_items i join public.casos c on c.id = i.caso_id
    where i.traspaso_id = p_traspaso
    order by c.codigo
  loop
    -- La descripción del ítem; si quedó vacía, la que ya tenía el caso.
    v_desc := coalesce(nullif(btrim(coalesce(v_item.descripcion, '')), ''), nullif(btrim(coalesce(v_item.descripcion_caso, '')), ''));

    if v_item.estado = 'cerrado' then
      perform set_config('app.origen', 'traspaso', true);
      update public.casos
         set estado = 'cerrado', etiqueta = v_item.etiqueta, descripcion = v_desc,
             recordatorio_fecha = null, recordatorio_texto = null
       where id = v_item.caso_id
       returning ultima_actualizacion_en into v_en;
      update public.traspaso_items set fecha_destino = null, descripcion = v_desc, actualizado_en = v_en where id = v_item.id;
      continue;
    end if;

    if v_item.para_tecnico_id is null then
      raise exception 'El caso % no tiene a quién traspasarse.', v_item.codigo;
    end if;
    v_propio := v_item.para_tecnico_id = v_t.de_tecnico_id;

    -- Mismo criterio para todos (D6). Para uno mismo solo cuenta mañana: hoy ya es su turno.
    select j.fecha_operativa, j.turno into v_destino
    from public.jornadas j
    where j.tecnico_id = v_item.para_tecnico_id
      and j.fecha_operativa in (v_t.fecha_operativa, v_t.fecha_operativa + 1)
      and (not v_propio or j.fecha_operativa > v_t.fecha_operativa)
      and public.desfase_traspaso(v_origen, j.turno) = j.fecha_operativa - v_t.fecha_operativa
    order by j.fecha_operativa
    limit 1;
    if not found then
      if v_propio then
        raise exception 'El caso % solo puede quedarse contigo si mañana estás planificado en un turno que reciba de %.',
          v_item.codigo, public.describir_turno(v_origen, null, null);
      end if;
      raise exception 'El receptor del caso % no está planificado en un turno que pueda recibir de %.',
        v_item.codigo, public.describir_turno(v_origen, null, null);
    end if;

    if v_desc is null then
      raise exception 'El caso % necesita su descripción para entregarse.', v_item.codigo;
    end if;

    v_texto := nullif(btrim(coalesce(v_item.recordatorio_texto, '')), '');
    if v_item.recordatorio_fecha is null and v_texto is not null then
      raise exception 'El recordatorio del caso % necesita una fecha.', v_item.codigo;
    end if;
    if v_item.recordatorio_fecha < v_t.fecha_operativa then
      raise exception 'El recordatorio del caso % tiene una fecha pasada.', v_item.codigo;
    end if;

    perform set_config('app.origen', 'traspaso', true);
    perform set_config('app.fecha_operativa', v_destino.fecha_operativa::text, true);
    update public.casos
       set tecnico_actual_id = v_item.para_tecnico_id,
           estado = v_item.estado,
           etiqueta = v_item.etiqueta,
           descripcion = v_desc,
           recordatorio_fecha = v_item.recordatorio_fecha,
           recordatorio_texto = v_texto
     where id = v_item.caso_id
     returning ultima_actualizacion_en into v_en;

    -- El responsable no cambia, así que el trigger no abre tramo: se pasa el caso a mañana a mano.
    if v_propio then
      update public.caso_responsables set hasta = clock_timestamp() where caso_id = v_item.caso_id and hasta is null;
      insert into public.caso_responsables (caso_id, tecnico_id, tecnico_nombre, fecha_operativa, origen, asignado_por)
      values (v_item.caso_id, v_t.de_tecnico_id, coalesce(v_nombre, '?'), v_destino.fecha_operativa, 'traspaso',
              coalesce(auth.jwt() ->> 'email', 'sistema'));
      perform public.registrar_bitacora('caso_traspasado', v_item.codigo, v_nombre,
        'Se queda con ' || coalesce(v_nombre, '?') || ' para su turno del ' || to_char(v_destino.fecha_operativa, 'DD/MM'));
    end if;

    update public.traspaso_items
       set fecha_destino = v_destino.fecha_operativa, descripcion = v_desc, actualizado_en = v_en
     where id = v_item.id;
    v_movidos := v_movidos + 1;
  end loop;

  perform set_config('app.origen', '', true);
  perform set_config('app.fecha_operativa', '', true);

  update public.traspasos
     set estado = 'enviado', turno_origen = v_origen, enviado_en = now(),
         enviado_por = coalesce(auth.jwt() ->> 'email', 'sistema')
   where id = p_traspaso;

  perform public.registrar_bitacora('traspaso_enviado', null, v_nombre,
    v_movidos || ' caso(s) traspasado(s) · ' || public.describir_turno(v_origen, null, null));

  return v_movidos;
end;
$$;

revoke all on function public.enviar_traspaso(uuid) from public, anon;
grant execute on function public.enviar_traspaso(uuid) to authenticated;

commit;
