-- =====================================================================
-- Panel NOC · v2.6 · Entrega de casos por supervisión (dispatch o coordinación)
-- Requiere 04 a 16. Idempotente: se puede ejecutar más de una vez.
--
-- D37: si un técnico se fue sin traspasar (o no trabaja hoy), el dispatch o coordinación reparte sus casos a otros
-- técnicos como si fuera un traspaso: el caso pasa al **seguimiento** de quien lo recibe ("Recibidos en traspaso",
-- origen 'traspaso', para hoy o mañana según su jornada), no al tablero del día. Avisa al receptor (notificación
-- 'traspaso') y queda en la bitácora ('entregado_por_supervision', con quién lo entregó).
--   · El receptor debe estar activo y planificado ese día (hoy o mañana) y su turno no puede haber terminado.
--   · Un caso puede quedarse con el mismo técnico para su turno de mañana (nuevo tramo, como D31).
--   · Todo o nada: si una entrega no vale, no se entrega ninguna.
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

begin;

-- Interna (recibe la hora para poder probarla). La app llama a entregar_casos(p_entregas).
create or replace function public.entregar_casos_en(p_entregas jsonb, p_ahora timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy     date := public.fecha_operativa(p_ahora);
  v_e       record;
  v_caso    public.casos%rowtype;
  v_nombre  text;
  v_fin     timestamptz;
  v_tramo   date;
  v_quien   text := coalesce(auth.jwt() ->> 'email', 'sistema');
  v_n       integer := 0;
begin
  if not (public.es_dispatch() or public.es_coordinador()) then
    raise exception 'Solo el dispatch o coordinación pueden entregar casos.' using errcode = '42501';
  end if;
  if p_entregas is null or jsonb_typeof(p_entregas) <> 'array' or jsonb_array_length(p_entregas) = 0 then
    raise exception 'No hay casos para entregar.';
  end if;

  for v_e in
    select (x ->> 'caso')::uuid as caso, (x ->> 'tecnico')::uuid as tecnico, (x ->> 'fecha')::date as fecha
    from jsonb_array_elements(p_entregas) x
  loop
    select * into v_caso from public.casos where id = v_e.caso for update;
    if not found or v_caso.estado = 'cerrado' then
      raise exception 'Uno de los casos ya no está abierto: actualiza la página y vuelve a intentarlo.';
    end if;
    if v_e.fecha is null or v_e.fecha not in (v_hoy, v_hoy + 1) then
      raise exception 'El caso % solo se puede entregar para hoy o mañana.', v_caso.codigo;
    end if;

    select t.nombre into v_nombre
    from public.tecnicos t
    join public.jornadas j on j.tecnico_id = t.id and j.fecha_operativa = v_e.fecha
    where t.id = v_e.tecnico and t.activo;
    if v_nombre is null then
      raise exception 'Quien recibe % no está planificado ese día.', v_caso.codigo;
    end if;

    v_fin := public.fin_de_turno(v_e.tecnico, v_e.fecha);
    if v_fin is null or p_ahora >= v_fin then
      raise exception '% ya terminó su turno: elige a otra persona para %.', v_nombre, v_caso.codigo;
    end if;

    select fecha_operativa into v_tramo from public.caso_responsables where caso_id = v_caso.id and hasta is null;

    perform set_config('app.origen', 'traspaso', true);
    perform set_config('app.fecha_operativa', v_e.fecha::text, true);

    if v_caso.tecnico_actual_id is distinct from v_e.tecnico then
      -- Los triggers cierran el tramo anterior, abren el nuevo (traspaso, fecha elegida) y avisan al receptor.
      update public.casos set tecnico_actual_id = v_e.tecnico where id = v_caso.id;
    elsif v_tramo is distinct from v_e.fecha then
      -- Mismo técnico, otro día (su turno de mañana): el responsable no cambia, el tramo se abre a mano.
      update public.caso_responsables set hasta = clock_timestamp() where caso_id = v_caso.id and hasta is null;
      insert into public.caso_responsables (caso_id, tecnico_id, tecnico_nombre, fecha_operativa, origen, asignado_por)
      values (v_caso.id, v_e.tecnico, v_nombre, v_e.fecha, 'traspaso', v_quien);
      insert into public.notificaciones (tecnico_id, tipo, caso_id, detalle) values (v_e.tecnico, 'traspaso', v_caso.id, v_caso.codigo);
    else
      raise exception 'El caso % ya es de % para ese día.', v_caso.codigo, v_nombre;
    end if;

    perform public.registrar_bitacora('entregado_por_supervision', v_caso.codigo, v_nombre,
      'Entregado a ' || v_nombre || ' para su turno del ' || to_char(v_e.fecha, 'DD/MM'));
    v_n := v_n + 1;
  end loop;

  perform set_config('app.origen', '', true);
  perform set_config('app.fecha_operativa', '', true);
  return v_n;
end;
$$;
revoke all on function public.entregar_casos_en(jsonb, timestamptz) from public, anon, authenticated;

-- p_entregas: [{ "caso": uuid, "tecnico": uuid, "fecha": "YYYY-MM-DD" }, …]. Devuelve cuántos se entregaron.
create or replace function public.entregar_casos(p_entregas jsonb)
returns integer
language sql
security definer
set search_path = public
as $$ select public.entregar_casos_en(p_entregas, now()); $$;
revoke all on function public.entregar_casos(jsonb) from public, anon;
grant execute on function public.entregar_casos(jsonb) to authenticated;

commit;
