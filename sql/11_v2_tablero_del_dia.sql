-- =====================================================================
-- 11 · v2 · Tablero del día (fase 10 · docs/DISENO_V2.md §11.1, §11.2, §11.12)
-- Requiere 04–10. Idempotente: se puede ejecutar más de una vez.
--
--  D16  El tablero de un día operativo = casos que el DISPATCH asignó ese día (asignación, reasignación o
--       reapertura; incluye la ronda). A las 06:00 está vacío. Lo traspasado vive en Mi seguimiento.
--  D17  estadisticas_del_dia() y el snapshot usan ese mismo criterio.
--  D18  El dispatch no cierra casos (lo impone el trigger). "Nuevo caso" recibe la EMPRESA (casos.cliente).
--  D25  cancelar_caso(): el dispatch borra un caso asignado hoy por error (única excepción a "no se borran").
--  D26  El dispatch corrige código y empresa; queda en la bitácora.
--  D28  La bitácora solo la leen dispatch y coordinación.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Qué cuenta como "asignación del dispatch" (= ORIGENES_DEL_TABLERO en domain/assignments.ts)
-- ---------------------------------------------------------------------
create or replace function public.origenes_del_tablero()
returns text[]
language sql
immutable
as $$ select array['dispatch', 'reasignacion', 'reapertura']::text[] $$;

-- Un caso por día operativo: la última asignación del dispatch de ese día (columna = a quién se lo dio).
-- Incluye los cerrados: el tablero es el registro del día.
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
       c.creado_en
from public.caso_responsables r
join public.casos c on c.id = r.caso_id
where r.origen = any (public.origenes_del_tablero())
order by r.caso_id, r.fecha_operativa, r.desde desc;

grant select on public.tablero_del_dia to authenticated;
revoke all on public.tablero_del_dia from anon;

comment on view public.tablero_del_dia is 'Casos que el dispatch asignó en cada día operativo (D16). Filtrar por fecha_operativa.';

-- ---------------------------------------------------------------------
-- 2. Estadísticas del día y snapshot con el mismo criterio (D17)
-- ---------------------------------------------------------------------
create or replace function public.estadisticas_del_dia(p_fecha date default public.fecha_operativa())
returns table (estado text, total integer)
language sql
stable
set search_path = public
as $$
  select t.estado, count(*)::integer
  from public.tablero_del_dia t
  where t.fecha_operativa = p_fecha
  group by t.estado;
$$;

revoke all on function public.estadisticas_del_dia(date) from public, anon;
grant execute on function public.estadisticas_del_dia(date) to authenticated;

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
                     'id', d.id, 'codigo', d.codigo, 'nota', d.nota, 'cliente', d.cliente, 'tecnicoId', t.id,
                     'creadoEn', d.asignado_en, 'estado', d.estado, 'etiqueta', d.etiqueta
                   ) order by d.asignado_en)
          from public.tablero_del_dia d
          where d.tecnico_asignado_id = t.id and d.fecha_operativa = p_fecha
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
-- 3. Antes de guardar un caso: el dispatch no cierra (D18); el resto igual que en la 07
-- ---------------------------------------------------------------------
create or replace function public.casos_antes_de_guardar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_desde_app  boolean := current_user = 'authenticated';
  v_es_tecnico boolean := current_user = 'authenticated' and not public.es_dispatch();
begin
  new.codigo  := upper(btrim(new.codigo));
  new.cliente := nullif(btrim(new.cliente), '');

  -- El dispatch asigna, no cierra: cerrar es del técnico (o del traspaso, que no es 'authenticated').
  if v_desde_app and not v_es_tecnico and new.estado = 'cerrado'
     and (tg_op = 'INSERT' or old.estado <> 'cerrado') then
    raise exception 'El dispatch no cierra casos: lo cierra el técnico en su seguimiento. Si fue un error, cancélalo.'
      using errcode = '42501';
  end if;

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

-- Corrección del código por el dispatch (D26): queda el valor anterior en la bitácora.
create or replace function public.bitacora_codigo_corregido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tecnico text;
begin
  select nombre into v_tecnico from public.tecnicos where id = new.tecnico_actual_id;
  perform public.registrar_bitacora('codigo_corregido', new.codigo, v_tecnico, 'Antes: ' || old.codigo);
  return null;
end;
$$;

revoke all on function public.bitacora_codigo_corregido() from public, anon, authenticated;

drop trigger if exists bitacora_codigo_corregido_trg on public.casos;
create trigger bitacora_codigo_corregido_trg
  after update of codigo on public.casos
  for each row when (old.codigo is distinct from new.codigo)
  execute function public.bitacora_codigo_corregido();

-- ---------------------------------------------------------------------
-- 4. Cancelar un caso (D25): deja de existir; la bitácora conserva sus datos y el técnico recibe aviso
-- ---------------------------------------------------------------------
alter table public.notificaciones alter column caso_id drop not null;
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones
  add constraint notificaciones_tipo_check check (tipo in ('asignado', 'reasignado', 'traspaso', 'recordatorio', 'cancelado'));

comment on column public.notificaciones.caso_id is 'Null solo en avisos de tipo "cancelado" (el caso ya no existe; el código va en detalle).';

drop function if exists public.cancelar_caso(uuid, text);
create function public.cancelar_caso(p_caso uuid, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caso     public.casos%rowtype;
  v_tecnico  text;
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.es_dispatch() then
    raise exception 'Solo el dispatch cancela casos.' using errcode = '42501';
  end if;

  select * into v_caso from public.casos where id = p_caso for update;
  if not found then
    raise exception 'El caso ya no existe.';
  end if;

  if not exists (select 1 from public.tablero_del_dia
                 where id = p_caso and fecha_operativa = public.fecha_operativa()) then
    raise exception 'Solo se cancelan casos asignados hoy desde el tablero (%).', v_caso.codigo;
  end if;

  if exists (select 1 from public.traspaso_items i join public.traspasos t on t.id = i.traspaso_id
             where i.caso_id = p_caso and t.estado = 'enviado') then
    raise exception '% ya se traspasó: no se puede cancelar. El técnico debe cerrarlo.', v_caso.codigo;
  end if;

  select nombre into v_tecnico from public.tecnicos where id = v_caso.tecnico_actual_id;

  perform public.registrar_bitacora('caso_cancelado', v_caso.codigo, v_tecnico,
    concat_ws(' · ',
      'Motivo: ' || coalesce(v_motivo, 'sin motivo'),
      'Empresa: ' || v_caso.cliente,
      'Estado: ' || public.describir_estado(v_caso.estado),
      'Área: ' || v_caso.area,
      'Etiqueta: ' || v_caso.etiqueta,
      'Descripción: ' || v_caso.descripcion));

  -- Responsables, notificaciones, ítems de traspaso en borrador y alertas se van en cascada.
  delete from public.casos where id = p_caso;

  if v_caso.tecnico_actual_id is not null then
    insert into public.notificaciones (tecnico_id, tipo, caso_id, detalle)
    values (v_caso.tecnico_actual_id, 'cancelado', null, v_caso.codigo);
  end if;

  return v_caso.codigo;
end;
$$;

revoke all on function public.cancelar_caso(uuid, text) from public, anon;
grant execute on function public.cancelar_caso(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Ronda: el segundo dato ahora es la empresa (D18)
-- ---------------------------------------------------------------------
drop function if exists public.asignar_a_ronda(text, text);
create function public.asignar_a_ronda(p_codigo text, p_empresa text default null)
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

  insert into public.casos (codigo, cliente, tecnico_actual_id)
  values (v_codigo, p_empresa, v_elegido.tecnico_id)
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

-- ---------------------------------------------------------------------
-- 6. Bitácora solo para supervisión (D28)
-- ---------------------------------------------------------------------
drop policy if exists "bitacora_leer_autenticados" on public.bitacora;
drop policy if exists "bitacora_leer_supervision"  on public.bitacora;
create policy "bitacora_leer_supervision"
  on public.bitacora for select to authenticated
  using (public.es_dispatch() or public.es_coordinador());

commit;
