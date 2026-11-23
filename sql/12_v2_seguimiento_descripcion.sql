-- =====================================================================
-- 12 · v2 · Seguimiento: descripción y última actualización (fase 12 · docs/DISENO_V2.md §11.3–11.5)
-- Requiere 04–11. Idempotente: se puede ejecutar más de una vez.
--
--  D19  "Última actualización" es una FECHA: la marca cualquier edición del técnico en su caso (área, empresa,
--       estado, etiqueta, descripción) o el botón "Actualizado" (marcar_actualizado). Es la misma referencia que
--       usan las alertas 2/4/6 h (actividad_tecnico_en).
--  D20  El texto del caso es la DESCRIPCIÓN (casos.descripcion), que ahora edita el técnico. La columna de texto
--       ultima_actualizacion deja de escribirse (no se borra): su contenido pasa a la descripción si estaba vacía.
--  D21  La nota del traspaso ES la descripción: el ítem lleva la descripción (precargada del caso); al enviar se
--       guarda en el caso y queda una foto en el ítem (descripcion + actualizado_en). Se exige descripción.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------
alter table public.casos drop constraint if exists casos_descripcion_largo;
alter table public.casos add constraint casos_descripcion_largo
  check (descripcion is null or char_length(descripcion) <= 2000);

alter table public.traspaso_items add column if not exists descripcion    text;
alter table public.traspaso_items add column if not exists actualizado_en timestamptz;
alter table public.traspaso_items drop constraint if exists traspaso_items_descripcion_largo;
alter table public.traspaso_items add constraint traspaso_items_descripcion_largo
  check (descripcion is null or char_length(descripcion) <= 2000);

comment on column public.casos.descripcion is 'Lo que pasa con el caso; la escribe el técnico y viaja en el traspaso (D20, D21).';
comment on column public.casos.ultima_actualizacion_en is 'Última vez que el técnico tocó el caso (edición o botón Actualizado, D19).';
comment on column public.casos.ultima_actualizacion is 'Histórico: texto anterior a la fase 12. Ya no se escribe (ver descripcion).';
comment on column public.traspaso_items.descripcion is 'Descripción con la que se entregó el caso (D21).';
comment on column public.traspaso_items.actualizado_en is 'Última actualización del caso al enviarse el traspaso.';

-- ---------------------------------------------------------------------
-- 2. Antes de guardar un caso (reemplaza la versión de la 11)
-- ---------------------------------------------------------------------
create or replace function public.casos_antes_de_guardar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_desde_app  boolean := current_user = 'authenticated';
  v_es_tecnico boolean := current_user = 'authenticated' and not public.es_dispatch();
  v_origen     text    := coalesce(current_setting('app.origen', true), '');
  v_marcar     boolean := coalesce(current_setting('app.marcar_actualizado', true), '') = 'si';
  v_ahora      timestamptz := clock_timestamp();
  v_quien      text := coalesce(auth.jwt() ->> 'email', 'sistema');
  v_actualiza  boolean := false;
begin
  new.codigo      := upper(btrim(new.codigo));
  new.cliente     := nullif(btrim(new.cliente), '');
  new.descripcion := nullif(btrim(new.descripcion), '');

  -- El dispatch asigna, no cierra (D18).
  if v_desde_app and not v_es_tecnico and new.estado = 'cerrado'
     and (tg_op = 'INSERT' or old.estado <> 'cerrado') then
    raise exception 'El dispatch no cierra casos: lo cierra el técnico en su seguimiento. Si fue un error, cancélalo.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- Un técnico (desde la app) cambia estado, etiqueta, área, empresa y descripción de SUS casos (RLS limita a
    -- sus casos). El traspaso y el botón Actualizado pasan por funciones propias (no son 'authenticated').
    if v_es_tecnico then
      if (new.codigo, new.tecnico_actual_id, new.creado_en, new.creado_por,
          new.recordatorio_fecha, new.recordatorio_texto, new.recordatorio_avisado_en)
         is distinct from
         (old.codigo, old.tecnico_actual_id, old.creado_en, old.creado_por,
          old.recordatorio_fecha, old.recordatorio_texto, old.recordatorio_avisado_en) then
        raise exception 'Solo el dispatch puede cambiar los datos o el responsable de un caso.' using errcode = '42501';
      end if;
    end if;

    if v_origen = 'migracion' and not v_desde_app then
      -- La migración fija las fechas a mano.
      null;
    else
      -- Cualquier edición del técnico es una actualización (D9, D19); también el botón Actualizado y la
      -- descripción con que se entrega en un traspaso.
      v_actualiza :=
        (v_es_tecnico and (new.estado, new.etiqueta, new.nota, new.area, new.cliente, new.descripcion, new.ultima_actualizacion)
                          is distinct from
                          (old.estado, old.etiqueta, old.nota, old.area, old.cliente, old.descripcion, old.ultima_actualizacion))
        or (v_marcar and not v_desde_app)
        or (v_origen = 'traspaso' and not v_desde_app and new.descripcion is distinct from old.descripcion);

      if v_actualiza then
        new.ultima_actualizacion_en  := v_ahora;
        new.ultima_actualizacion_por := v_quien;
      else
        new.ultima_actualizacion_en  := old.ultima_actualizacion_en;
        new.ultima_actualizacion_por := old.ultima_actualizacion_por;
      end if;

      -- La actividad del técnico (alertas de coordinación) la mueven solo él y su botón.
      if (v_es_tecnico and v_actualiza) or (v_marcar and not v_desde_app) then
        new.actividad_tecnico_en := v_ahora;
      else
        new.actividad_tecnico_en := old.actividad_tecnico_en;
      end if;
    end if;

    -- Un recordatorio nuevo o cambiado vuelve a quedar pendiente de aviso.
    if (new.recordatorio_fecha, new.recordatorio_texto) is distinct from (old.recordatorio_fecha, old.recordatorio_texto) then
      new.recordatorio_avisado_en := null;
    end if;

    if new.estado = 'cerrado' and old.estado <> 'cerrado' then
      new.cerrado_en := v_ahora;
    elsif new.estado <> 'cerrado' then
      new.cerrado_en := null;
    else
      new.cerrado_en := old.cerrado_en;
    end if;
  else
    new.ultima_actualizacion_en  := null;
    new.ultima_actualizacion_por := null;
    new.actividad_tecnico_en    := null;
    new.recordatorio_avisado_en := null;
    new.cerrado_en := case when new.estado = 'cerrado' then v_ahora end;
  end if;

  return new;
end;
$$;

-- La bitácora registra la descripción (en lugar del texto de última actualización).
create or replace function public.bitacora_descripcion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tecnico text;
begin
  select nombre into v_tecnico from public.tecnicos where id = new.tecnico_actual_id;
  perform public.registrar_bitacora('descripcion_cambiada', new.codigo, v_tecnico, coalesce(new.descripcion, 'Sin descripción'));
  return null;
end;
$$;

revoke all on function public.bitacora_descripcion() from public, anon, authenticated;

drop trigger if exists bitacora_descripcion_trg on public.casos;
create trigger bitacora_descripcion_trg
  after update of descripcion on public.casos
  for each row when (old.descripcion is distinct from new.descripcion)
  execute function public.bitacora_descripcion();

-- ---------------------------------------------------------------------
-- 3. Botón "Actualizado": el técnico confirma que revisó su caso sin cambiar nada (D19)
-- ---------------------------------------------------------------------
create or replace function public.marcar_actualizado(p_caso uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caso public.casos%rowtype;
begin
  select * into v_caso from public.casos where id = p_caso for update;
  if not found or v_caso.tecnico_actual_id is null or v_caso.tecnico_actual_id is distinct from public.mi_tecnico_id() then
    raise exception 'Solo el responsable puede marcar su caso como actualizado.' using errcode = '42501';
  end if;
  if v_caso.estado = 'cerrado' then
    raise exception 'El caso % está cerrado.', v_caso.codigo;
  end if;

  perform set_config('app.marcar_actualizado', 'si', true);
  update public.casos set ultima_actualizacion_en = now() where id = p_caso
    returning ultima_actualizacion_en into v_caso.ultima_actualizacion_en;
  perform set_config('app.marcar_actualizado', '', true);
  return v_caso.ultima_actualizacion_en;
end;
$$;

revoke all on function public.marcar_actualizado(uuid) from public, anon;
grant execute on function public.marcar_actualizado(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. enviar_traspaso: la nota del ítem es la descripción (D21)
--    Mismas reglas que la 07 (D2, D6, recordatorios); cambia solo el texto que se exige y se guarda.
-- ---------------------------------------------------------------------
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

  select count(*) into v_faltantes
  from public.casos c
  where c.tecnico_actual_id = v_t.de_tecnico_id and c.estado <> 'cerrado'
    and not exists (select 1 from public.traspaso_items i where i.traspaso_id = p_traspaso and i.caso_id = c.id);
  if v_faltantes > 0 then
    raise exception 'Quedan % caso(s) sin incluir en el traspaso: tu carga debe quedar en 0.', v_faltantes;
  end if;

  if exists (select 1 from public.traspaso_items i join public.casos c on c.id = i.caso_id
             where i.traspaso_id = p_traspaso and c.tecnico_actual_id is distinct from v_t.de_tecnico_id) then
    raise exception 'El traspaso incluye casos que no son tuyos.';
  end if;

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

  perform public.registrar_bitacora('traspaso_enviado', null,
    (select nombre from public.tecnicos where id = v_t.de_tecnico_id),
    v_movidos || ' caso(s) traspasado(s) · ' || public.describir_turno(v_origen, null, null));

  return v_movidos;
end;
$$;

revoke all on function public.enviar_traspaso(uuid) from public, anon;
grant execute on function public.enviar_traspaso(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Datos existentes: el texto de última actualización pasa a la descripción (solo si estaba vacía)
-- ---------------------------------------------------------------------
do $$
declare
  v_movidos integer;
begin
  perform set_config('app.origen', 'migracion', true);
  update public.casos
     set descripcion = btrim(ultima_actualizacion),
         ultima_actualizacion_en = greatest(ultima_actualizacion_en, actividad_tecnico_en)
   where nullif(btrim(coalesce(descripcion, '')), '') is null
     and nullif(btrim(coalesce(ultima_actualizacion, '')), '') is not null;
  get diagnostics v_movidos = row_count;
  perform set_config('app.origen', '', true);
  if v_movidos > 0 then
    perform public.registrar_bitacora('migracion_descripcion', null, null,
      v_movidos || ' caso(s): la última actualización escrita pasó a la descripción (migración 12)');
  end if;
end;
$$;

commit;
