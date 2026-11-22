-- =====================================================================
-- Panel NOC · migración v7 — diseño v2, fase 5: casos + traspasos (docs/DISENO_V2.md §10)
--   Requiere 04, 05 y 06. Idempotente: se puede ejecutar más de una vez.
--
--   1. Áreas: catálogo fijo (mismo que AREAS_DE_CASO en src/domain/areas.ts). Un área fuera del
--      catálogo queda en null (antes se anota en la bitácora).
--   2. El técnico registra área y empresa (cliente) de SUS casos; toda edición suya marca
--      casos.actividad_tecnico_en (referencia de las alertas de coordinación, fase 6).
--   3. Recordatorio con fecha: se deja en el ítem del traspaso, pasa al caso al enviar y avisa al
--      inicio del turno de quien tenga el caso ese día (generar_recordatorios(), pg_cron cada 5 min).
--   4. traspaso_items.fecha_destino: día operativo en que el receptor recibió el caso ("Mis traspasos").
--   5. casos_abiertos suma al final actividad_tecnico_en, recordatorio_fecha y recordatorio_texto.
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Áreas del caso
-- ---------------------------------------------------------------------
create or replace function public.areas_de_caso()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['CPE', 'PLEX', 'TX', 'CORE CS', 'CORE IP', 'CORE PS', 'SIO', 'SOPORTE DIGITAL',
               'FRESH', 'REDPRO', 'PVR', 'REGIONAL', 'COMERCIAL'];
$$;

alter table public.casos drop constraint if exists casos_area_valida;

select public.registrar_bitacora('area_descartada', c.codigo, null, 'Área anterior fuera del catálogo: ' || c.area)
from public.casos c
where c.area is not null and not (c.area = any (public.areas_de_caso()));

update public.casos set area = null
where area is not null and not (area = any (public.areas_de_caso()));

alter table public.casos
  add constraint casos_area_valida check (area is null or area = any (public.areas_de_caso()));

-- ---------------------------------------------------------------------
-- 2 y 3. Columnas nuevas del caso y del ítem de traspaso
-- ---------------------------------------------------------------------
alter table public.casos add column if not exists actividad_tecnico_en   timestamptz;
alter table public.casos add column if not exists recordatorio_fecha     date;
alter table public.casos add column if not exists recordatorio_texto     text;
alter table public.casos add column if not exists recordatorio_avisado_en timestamptz;
alter table public.casos drop constraint if exists casos_recordatorio_texto_largo;
alter table public.casos add constraint casos_recordatorio_texto_largo
  check (recordatorio_texto is null or char_length(recordatorio_texto) <= 200);
alter table public.casos drop constraint if exists casos_cliente_largo;
alter table public.casos add constraint casos_cliente_largo check (cliente is null or char_length(cliente) <= 120);

comment on column public.casos.actividad_tecnico_en is 'Última vez que el técnico responsable editó el caso (estado, etiqueta, área, empresa, nota o última actualización).';
comment on column public.casos.recordatorio_fecha is 'Día operativo en que se avisa al responsable, al inicio de su turno (lo deja quien traspasa).';

create index if not exists casos_recordatorio_pendiente_idx on public.casos (recordatorio_fecha)
  where recordatorio_fecha is not null and recordatorio_avisado_en is null and estado <> 'cerrado';

alter table public.traspaso_items add column if not exists recordatorio_fecha date;
alter table public.traspaso_items add column if not exists recordatorio_texto text;
alter table public.traspaso_items add column if not exists fecha_destino      date;
alter table public.traspaso_items drop constraint if exists traspaso_items_recordatorio_texto_largo;
alter table public.traspaso_items add constraint traspaso_items_recordatorio_texto_largo
  check (recordatorio_texto is null or char_length(recordatorio_texto) <= 200);

create index if not exists traspaso_items_destino_idx on public.traspaso_items (para_tecnico_id, fecha_destino);

comment on column public.traspaso_items.fecha_destino is 'Día operativo en que el receptor recibió el caso (lo escribe enviar_traspaso).';

-- ---------------------------------------------------------------------
-- 2. Antes de guardar un caso: el técnico ahora registra área y empresa; se marca su actividad
-- ---------------------------------------------------------------------
create or replace function public.casos_antes_de_guardar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_es_tecnico boolean := current_user = 'authenticated' and not public.es_dispatch();
begin
  new.codigo  := upper(btrim(new.codigo));
  new.cliente := nullif(btrim(new.cliente), '');

  if tg_op = 'UPDATE' then
    -- Un técnico (desde la app) solo cambia estado, etiqueta, nota, área, empresa y última actualización
    -- de SUS casos (RLS limita a sus casos). El traspaso pasa por enviar_traspaso(), que no es 'authenticated'.
    if v_es_tecnico then
      if (new.codigo, new.descripcion, new.tecnico_actual_id, new.creado_en, new.creado_por,
          new.recordatorio_fecha, new.recordatorio_texto, new.recordatorio_avisado_en)
         is distinct from
         (old.codigo, old.descripcion, old.tecnico_actual_id, old.creado_en, old.creado_por,
          old.recordatorio_fecha, old.recordatorio_texto, old.recordatorio_avisado_en) then
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

    -- Cualquier edición del técnico cuenta como actualización (D9); nadie más la toca.
    if v_es_tecnico and (new.estado, new.etiqueta, new.nota, new.area, new.cliente, new.ultima_actualizacion)
                        is distinct from
                        (old.estado, old.etiqueta, old.nota, old.area, old.cliente, old.ultima_actualizacion) then
      new.actividad_tecnico_en := clock_timestamp();
    else
      new.actividad_tecnico_en := old.actividad_tecnico_en;
    end if;

    -- Un recordatorio nuevo o cambiado vuelve a quedar pendiente de aviso.
    if (new.recordatorio_fecha, new.recordatorio_texto) is distinct from (old.recordatorio_fecha, old.recordatorio_texto) then
      new.recordatorio_avisado_en := null;
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
    new.actividad_tecnico_en    := null;
    new.recordatorio_avisado_en := null;
    new.cerrado_en := case when new.estado = 'cerrado' then clock_timestamp() end;
  end if;

  return new;
end;
$$;

-- Bitácora de área y empresa (se suman a estado, etiqueta y última actualización).
create or replace function public.bitacora_area_y_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tecnico text;
begin
  select nombre into v_tecnico from public.tecnicos where id = new.tecnico_actual_id;
  if new.area is distinct from old.area then
    perform public.registrar_bitacora('area_cambiada', new.codigo, v_tecnico, coalesce(new.area, 'Sin área'));
  end if;
  if new.cliente is distinct from old.cliente then
    perform public.registrar_bitacora('empresa_cambiada', new.codigo, v_tecnico, coalesce(new.cliente, 'Sin empresa'));
  end if;
  return null;
end;
$$;

revoke all on function public.bitacora_area_y_empresa() from public, anon, authenticated;

drop trigger if exists bitacora_area_y_empresa_trg on public.casos;
create trigger bitacora_area_y_empresa_trg
  after update of area, cliente on public.casos
  for each row execute function public.bitacora_area_y_empresa();

-- ---------------------------------------------------------------------
-- 3. Notificaciones de tipo "recordatorio"
-- ---------------------------------------------------------------------
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones
  add constraint notificaciones_tipo_check check (tipo in ('asignado', 'reasignado', 'traspaso', 'recordatorio'));

-- Hora (Honduras) en que empieza el turno de un técnico un día operativo; 06:00 si no tiene jornada.
create or replace function public.inicio_de_turno(p_tecnico uuid, p_fecha date)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select ((p_fecha + coalesce(
            (select case j.turno
                      when 'turnoA' then time '06:00'
                      when 'turnoB' then time '14:00'
                      when 'turnoC' then time '22:00'
                      else j.horario_inicio
                    end
             from public.jornadas j
             where j.tecnico_id = p_tecnico and j.fecha_operativa = p_fecha),
            time '06:00'))::timestamp at time zone 'America/Tegucigalpa');
$$;

revoke all on function public.inicio_de_turno(uuid, date) from public, anon;
grant execute on function public.inicio_de_turno(uuid, date) to authenticated;

-- Avisa los recordatorios vencidos: al llegar el inicio del turno del responsable el día indicado
-- (o enseguida si esa fecha ya pasó). Cada recordatorio se avisa una sola vez. Devuelve cuántos avisó.
create or replace function public.generar_recordatorios(p_ahora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caso    record;
  v_avisos  integer := 0;
begin
  for v_caso in
    select c.id, c.codigo, c.tecnico_actual_id, c.recordatorio_texto
    from public.casos c
    where c.recordatorio_fecha is not null
      and c.recordatorio_avisado_en is null
      and c.estado <> 'cerrado'
      and c.tecnico_actual_id is not null
      and c.recordatorio_fecha <= public.fecha_operativa(p_ahora)
      and p_ahora >= public.inicio_de_turno(c.tecnico_actual_id, c.recordatorio_fecha)
    for update of c skip locked
  loop
    insert into public.notificaciones (tecnico_id, tipo, caso_id, detalle)
    values (v_caso.tecnico_actual_id, 'recordatorio', v_caso.id,
            v_caso.codigo || coalesce(': ' || nullif(btrim(v_caso.recordatorio_texto), ''), ''));
    update public.casos set recordatorio_avisado_en = p_ahora where id = v_caso.id;
    v_avisos := v_avisos + 1;
  end loop;
  return v_avisos;
end;
$$;

revoke all on function public.generar_recordatorios(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 y 4. enviar_traspaso: copia el recordatorio al caso y guarda la fecha de destino del ítem
--   Mismas reglas que la 04 (D2, D6). Además, un recordatorio no puede tener fecha pasada.
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
             ultima_actualizacion = coalesce(nullif(btrim(v_item.ultima_actualizacion), ''), ultima_actualizacion),
             recordatorio_fecha = null, recordatorio_texto = null
       where id = v_item.caso_id;
      update public.traspaso_items set fecha_destino = null where id = v_item.id;
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
           ultima_actualizacion = btrim(v_item.ultima_actualizacion),
           recordatorio_fecha = v_item.recordatorio_fecha,
           recordatorio_texto = v_texto
     where id = v_item.caso_id;
    update public.traspaso_items set fecha_destino = v_destino.fecha_operativa where id = v_item.id;
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
-- 5. Vista del tablero y del seguimiento (columnas nuevas al final)
-- ---------------------------------------------------------------------
create or replace view public.casos_abiertos
with (security_invoker = true) as
select c.id, c.codigo, c.cliente, c.area, c.descripcion, c.nota, c.estado, c.etiqueta,
       c.tecnico_actual_id, c.ultima_actualizacion, c.ultima_actualizacion_en, c.creado_en,
       r.fecha_operativa as fecha_responsable,
       r.desde           as asignado_en,
       r.origen          as origen_responsable,
       c.ultima_actualizacion_por,
       c.actividad_tecnico_en,
       c.recordatorio_fecha,
       c.recordatorio_texto
from public.casos c
left join public.caso_responsables r on r.caso_id = c.id and r.hasta is null
where c.estado <> 'cerrado';

grant select on public.casos_abiertos to authenticated;
revoke all on public.casos_abiertos from anon;

commit;

-- =====================================================================
-- 6. Recordatorios cada 5 minutos (pg_cron, solo en Supabase)
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'recordatorios-traspaso';

select cron.schedule(
  'recordatorios-traspaso',
  '*/5 * * * *',
  $$ select public.generar_recordatorios(); $$
);
