-- =====================================================================
-- Panel NOC · datos de prueba SOLO PARA LA BASE DE DESARROLLO (modelo v2, requiere 04 a 14)
--
-- Arma un escenario completo relativo a HOY (día operativo en que se ejecuta): planificación de dos semanas,
-- casos del tablero de hoy en todos los estados y tipos, casos "por reasignar", traspasos enviados (ayer y
-- hoy) y un borrador, recordatorios, alertas de coordinación, solicitudes de planificación, notificaciones,
-- historial (snapshots) y casos cerrados para el buscador. Guía de lo que se puede probar con cada usuario:
-- docs/interno/DATOS_DE_PRUEBA.md (local, no se versiona).
--
-- Se puede repetir: cada ejecución borra los datos operativos (jornadas, casos, traspasos, notificaciones,
-- alertas, solicitudes, ronda, bitácora y snapshots) y vuelve a crear el escenario con las fechas de ese día.
-- NO toca auth.users ni perfiles. Los técnicos se buscan por nombre; si falta alguno se crea y todos quedan
-- activos. Los nombres de este archivo son ficticios: en el repositorio no va ningún nombre real. Para correrlo
-- sobre técnicos reales, usa una copia local con sus nombres (docs/interno/, no se versiona).
--
-- Protección contra accidentes: se niega a ejecutarse si la base no tiene la tabla marcadora "entorno_dev"
-- (solo existe en DEV; se crea una vez con:  create table public.entorno_dev (id int);).
-- =====================================================================

do $$
begin
  if to_regclass('public.entorno_dev') is null then
    raise exception 'Esta NO es la base de desarrollo (falta la tabla public.entorno_dev). No se hizo ningún cambio.';
  end if;
end;
$$;

begin;

-- ---------------------------------------------------------------------
-- 0. Vaciar los datos operativos
-- ---------------------------------------------------------------------
truncate public.notificaciones, public.alertas_coordinacion, public.traspaso_items, public.traspasos,
         public.caso_responsables, public.casos, public.jornadas, public.solicitudes_planificacion,
         public.ronda_estado, public.historial_snapshots, public.bitacora;

-- ---------------------------------------------------------------------
-- 1. Técnicos (los reales de DEV; se crean si faltan)
--    i = desfase de su día libre: descansa los días en que (fecha - hoy + i) es múltiplo de 7.
--    Así hoy descansan Diana Soto y Raúl Vega (i = 0) y sus casos salen en "Por reasignar".
-- ---------------------------------------------------------------------
create temporary table plantilla (nombre text primary key, turno text, hi time, hf time, ai time, af time, i int) on commit drop;
insert into plantilla values
  ('Ana Pérez',   'turnoA',  null,    null,    '10:00', '10:30', 1),
  ('Bruno Díaz',  'turnoA',  null,    null,    '11:00', '11:30', 2),
  ('Carla Rivas', 'turnoA',  null,    null,    '12:00', '12:30', 3),
  ('Diana Soto',  'turnoA',  null,    null,    '12:30', '13:00', 0),
  ('Luis Mora',   'turnoB',  null,    null,    '18:00', '18:30', 4),
  ('Marta Ruiz',  'turnoB',  null,    null,    '18:30', '19:00', 5),
  ('Pedro Lagos', 'turnoB',  null,    null,    null,    null,    6),
  ('Raúl Vega',   'turnoB',  null,    null,    '19:00', '19:30', 0),
  ('Sofía Cruz',  'turnoC',  '00:00', '06:00', '02:00', '02:30', 1),
  ('Tomás León',  'turnoC',  '22:00', '06:00', '03:00', '03:30', 4),
  ('Elena Paz',   'comodin', '06:00', '16:00', '12:00', '13:00', 2),
  ('Hugo Ríos',   'comodin', '08:00', '18:00', '13:00', '13:30', 5);

insert into public.tecnicos (nombre)
select nombre from plantilla
on conflict (lower(btrim(nombre))) do nothing;

update public.tecnicos set activo = true
where lower(btrim(nombre)) in (select lower(nombre) from plantilla);

-- ---------------------------------------------------------------------
-- 2. Planificación: desde hace 7 días hasta dentro de 5 (los últimos días de la semana próxima quedan
--    sin planificar para probar "copiar semana"). Los domingos el comodín Hugo entra 07-17.
--    Turno C por tramos (14): Sofía solo C2 (00-06) y Tomás C1 + C2 (toda la noche).
-- ---------------------------------------------------------------------
insert into public.jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin, almuerzo_inicio, almuerzo_fin)
select d::date, t.id, p.turno,
       case when p.nombre = 'Hugo Ríos' and extract(isodow from d) = 7 then '07:00'::time else p.hi end,
       case when p.nombre = 'Hugo Ríos' and extract(isodow from d) = 7 then '17:00'::time else p.hf end,
       p.ai, p.af
from plantilla p
join public.tecnicos t on lower(btrim(t.nombre)) = lower(p.nombre)
cross join generate_series(public.fecha_operativa() - 7, public.fecha_operativa() + 5, interval '1 day') as d
where (((d::date - public.fecha_operativa()) + p.i) % 7 + 7) % 7 <> 0;

-- ---------------------------------------------------------------------
-- 3. Ayudantes (solo existen durante esta sesión)
--    Mientras se cargan los datos se apaga el trigger que normaliza y sella fechas de los casos
--    (casos_antes_de_guardar): aquí las fechas se fijan a mano para simular días anteriores. Se vuelve a
--    encender al final, dentro de la misma transacción (si algo falla, no queda apagado).
-- ---------------------------------------------------------------------
alter table public.casos disable trigger casos_antes_de_guardar_trg;

create or replace function pg_temp.tec(p_nombre text) returns uuid language sql stable as $$
  select id from public.tecnicos where lower(btrim(nombre)) = lower(btrim(p_nombre));
$$;

-- Correo del técnico (para "actualizado por"); si no tiene perfil, su nombre.
create or replace function pg_temp.correo(p_tecnico uuid) returns text language sql stable as $$
  select coalesce((select u.email from public.perfiles p join auth.users u on u.id = p.id where p.tecnico_id = p_tecnico limit 1),
                  (select nombre from public.tecnicos where id = p_tecnico));
$$;

-- Momento de un día operativo a una hora de Honduras (las 00:00-05:59 son del día siguiente en el reloj).
create or replace function pg_temp.en(p_dias int, p_hora time) returns timestamptz language sql stable as $$
  select ((public.fecha_operativa() + p_dias + case when p_hora < time '06:00' then 1 else 0 end) + p_hora)::timestamp
         at time zone 'America/Tegucigalpa';
$$;

-- Hace un rato, sin salirse del día operativo de hoy.
create or replace function pg_temp.hace(p_rato interval) returns timestamptz language sql stable as $$
  select least(now(), greatest(now() - p_rato, pg_temp.en(0, time '06:05')));
$$;

-- Crea un caso asignado por el dispatch en el día operativo (hoy + p_dias) a la hora p_cuando, y lo deja en
-- el estado pedido. p_actividad = última actualización del técnico (null = nunca lo tocó).
create or replace function pg_temp.caso(
  p_codigo text, p_cliente text, p_area text, p_descripcion text, p_estado text, p_etiqueta text,
  p_tecnico text, p_dias int, p_cuando timestamptz, p_actividad timestamptz default null, p_cerrado timestamptz default null)
returns uuid language plpgsql as $$
declare
  v_id  uuid;
  v_tec uuid := pg_temp.tec(p_tecnico);
begin
  perform set_config('app.origen', 'dispatch', true);
  perform set_config('app.fecha_operativa', (public.fecha_operativa() + p_dias)::text, true);
  insert into public.casos (codigo, cliente, area, descripcion, etiqueta, tecnico_actual_id, creado_por)
  values (p_codigo, p_cliente, p_area, p_descripcion, p_etiqueta, v_tec, 'dispatch')
  returning id into v_id;

  -- Estado y fechas a mano ('migracion' evita bitácora y avisos de este ajuste).
  perform set_config('app.origen', 'migracion', true);
  perform set_config('app.fecha_operativa', '', true);
  update public.casos
     set estado = p_estado, creado_en = p_cuando, actividad_tecnico_en = p_actividad,
         ultima_actualizacion_en = p_actividad,
         ultima_actualizacion_por = case when p_actividad is not null then pg_temp.correo(v_tec) end
   where id = v_id;
  update public.casos set cerrado_en = coalesce(p_cerrado, p_actividad, p_cuando) where id = v_id and p_estado = 'cerrado';
  update public.caso_responsables set desde = p_cuando, asignado_por = 'dispatch' where caso_id = v_id;
  update public.caso_responsables set hasta = coalesce(p_cerrado, p_actividad, p_cuando)
   where caso_id = v_id and p_estado = 'cerrado';
  update public.notificaciones set creado_en = p_cuando where caso_id = v_id;
  perform set_config('app.origen', '', true);
  return v_id;
end;
$$;

-- Pasa un caso de manos como lo hace enviar_traspaso (sin pedir sesión) y deja el ítem enviado.
create or replace function pg_temp.traspasar(
  p_traspaso uuid, p_codigo text, p_para text, p_destino_dias int, p_estado text, p_etiqueta text,
  p_descripcion text, p_cuando timestamptz, p_rec_dias int default null, p_rec_texto text default null)
returns void language plpgsql as $$
declare
  v_id   uuid;
  v_para uuid := pg_temp.tec(p_para);
  v_rec  date := public.fecha_operativa() + p_rec_dias;
begin
  select id into v_id from public.casos where codigo = p_codigo;
  insert into public.traspaso_items (traspaso_id, caso_id, para_tecnico_id, estado, etiqueta, descripcion,
                                     recordatorio_fecha, recordatorio_texto, fecha_destino, actualizado_en)
  values (p_traspaso, v_id, case when p_estado = 'cerrado' then null else v_para end, p_estado, p_etiqueta, p_descripcion,
          v_rec, p_rec_texto, case when p_estado = 'cerrado' then null else public.fecha_operativa() + p_destino_dias end,
          p_cuando);

  perform set_config('app.origen', 'traspaso', true);
  if p_estado = 'cerrado' then
    update public.casos set estado = 'cerrado', etiqueta = p_etiqueta, descripcion = p_descripcion where id = v_id;
  else
    perform set_config('app.fecha_operativa', (public.fecha_operativa() + p_destino_dias)::text, true);
    update public.casos
       set tecnico_actual_id = v_para, estado = p_estado, etiqueta = p_etiqueta, descripcion = p_descripcion,
           recordatorio_fecha = v_rec, recordatorio_texto = p_rec_texto
     where id = v_id;
  end if;

  perform set_config('app.origen', 'migracion', true);
  perform set_config('app.fecha_operativa', '', true);
  update public.casos
     set ultima_actualizacion_en = p_cuando,
         ultima_actualizacion_por = (select enviado_por from public.traspasos where id = p_traspaso),
         cerrado_en = case when estado = 'cerrado' then p_cuando end
   where id = v_id;
  update public.caso_responsables set hasta = p_cuando where caso_id = v_id and hasta > p_cuando;
  update public.caso_responsables set desde = p_cuando, asignado_por = 'traspaso'
   where caso_id = v_id and hasta is null and origen = 'traspaso';
  update public.notificaciones set creado_en = p_cuando where caso_id = v_id and tipo = 'traspaso' and creado_en > p_cuando;
  perform set_config('app.origen', '', true);
end;
$$;

create or replace function pg_temp.traspaso(p_de text, p_dias int, p_estado text, p_cuando timestamptz) returns uuid
language sql as $$
  insert into public.traspasos (de_tecnico_id, fecha_operativa, turno_origen, estado, creado_en, enviado_en, enviado_por)
  select t.id, public.fecha_operativa() + p_dias, j.turno, p_estado, p_cuando - interval '20 minutes',
         case when p_estado = 'enviado' then p_cuando end,
         case when p_estado = 'enviado' then pg_temp.correo(t.id) end
  from public.tecnicos t
  left join public.jornadas j on j.tecnico_id = t.id and j.fecha_operativa = public.fecha_operativa() + p_dias
  where t.id = pg_temp.tec(p_de)
  returning id;
$$;

create or replace function pg_temp.tr(p_de text, p_dias int) returns uuid language sql stable as $$
  select id from public.traspasos where de_tecnico_id = pg_temp.tec(p_de) and fecha_operativa = public.fecha_operativa() + p_dias;
$$;

-- ---------------------------------------------------------------------
-- 4. Historial: casos cerrados de días anteriores (Buscar casos, Historial, "reabrir")
-- ---------------------------------------------------------------------
select pg_temp.caso('INC0097001', 'BANCO ATLANTIDA', 'CORE IP', 'Caída de enlace MPLS en agencia La Ceiba. Se cambió el puerto en el PE y quedó estable.',
                    'cerrado', null, 'Carla Rivas', -3, pg_temp.en(-3, '07:40'), pg_temp.en(-3, '11:15'));
select pg_temp.caso('SCTASK0197001', 'GRUPO JAREMAR', 'PLEX', 'Alta de 3 extensiones en la central virtual.',
                    'cerrado', null, 'Luis Mora', -3, pg_temp.en(-3, '15:20'), pg_temp.en(-3, '17:05'));
select pg_temp.caso('#SR0397001', 'CLIENTE RESIDENCIAL', 'FRESH', 'Sin navegación tras cambio de módem. Se reaprovisionó la ONT.',
                    'cerrado', 'Seguimiento', 'Sofía Cruz', -3, pg_temp.en(-3, '23:10'), pg_temp.en(-3, '01:30'));
select pg_temp.caso('INC0098001', 'FICOHSA', 'CPE', 'Router de sucursal reiniciándose. Se reemplazó la fuente.',
                    'cerrado', null, 'Ana Pérez', -2, pg_temp.en(-2, '08:10'), pg_temp.en(-2, '12:40'));

-- INC0098002: reasignado por el dispatch de Marta a Pedro y cerrado al día siguiente (historial con 2 responsables).
select pg_temp.caso('INC0098002', 'BILLETERA MOVIL', 'CORE PS', 'Lentitud en APN corporativo. Se depuró la tabla de sesiones en el PGW.',
                    'en_curso', 'Escalar', 'Marta Ruiz', -2, pg_temp.en(-2, '14:30'), pg_temp.en(-2, '15:00'));
select set_config('app.fecha_operativa', (public.fecha_operativa() - 2)::text, true);
update public.casos set tecnico_actual_id = pg_temp.tec('Pedro Lagos') where codigo = 'INC0098002';
select set_config('app.fecha_operativa', '', true);
select set_config('app.origen', 'migracion', true);
update public.caso_responsables set hasta = pg_temp.en(-2, '16:00')
 where caso_id = (select id from public.casos where codigo = 'INC0098002') and origen = 'dispatch';
update public.caso_responsables set desde = pg_temp.en(-2, '16:00'), asignado_por = 'dispatch'
 where caso_id = (select id from public.casos where codigo = 'INC0098002') and origen = 'reasignacion';
update public.notificaciones set creado_en = pg_temp.en(-2, '16:00')
 where caso_id = (select id from public.casos where codigo = 'INC0098002') and tipo = 'reasignado';
update public.casos set estado = 'cerrado' where codigo = 'INC0098002';
update public.casos set cerrado_en = pg_temp.en(-1, '15:30'), ultima_actualizacion_en = pg_temp.en(-1, '15:30'),
       actividad_tecnico_en = pg_temp.en(-1, '15:30') where codigo = 'INC0098002';
update public.caso_responsables set hasta = pg_temp.en(-1, '15:30')
 where caso_id = (select id from public.casos where codigo = 'INC0098002') and hasta > pg_temp.en(-1, '15:30');
select set_config('app.origen', '', true);

-- ---------------------------------------------------------------------
-- 5. Ayer: casos que siguen abiertos (por reasignar, traspasados)
-- ---------------------------------------------------------------------
-- Diana (A) y Raúl (B) trabajaron ayer, no cerraron turno y hoy descansan → "Por reasignar" (solo dispatch).
select pg_temp.caso('INC0099004', 'HONDUTEL', 'TX', 'Alarma de potencia baja en radioenlace Tegucigalpa - Comayagua.',
                    'en_curso', 'Monitoreo', 'Diana Soto', -1, pg_temp.en(-1, '09:20'), pg_temp.en(-1, '13:10'));
select pg_temp.caso('SCTASK0199002', 'BANCO DE OCCIDENTE', 'CORE IP', 'Configurar túnel IPsec con sitio alterno. Falta ventana del cliente.',
                    'pausado', 'Pendiente cliente', 'Diana Soto', -1, pg_temp.en(-1, '10:05'), pg_temp.en(-1, '12:50'));
select pg_temp.caso('INC0099005', 'CERVECERIA HONDUREÑA', 'CPE', null,
                    'en_curso', null, 'Raúl Vega', -1, pg_temp.en(-1, '17:45'), null);

-- Recordatorio para hoy en un caso de Diana, que hoy no trabaja → aviso + alerta "recordatorio sin jornada".
update public.casos set recordatorio_fecha = public.fecha_operativa(), recordatorio_texto = 'Confirmar ventana con el cliente'
 where codigo = 'SCTASK0199002';

-- Luis (B) cerró turno ayer: un caso a Tomás (C, mismo día), dos a Ana (A, hoy) con recordatorio y uno cerrado.
select pg_temp.caso('INC0099001', 'BAC CREDOMATIC', 'CORE IP', 'Pérdida de paquetes intermitente hacia el DC secundario.',
                    'en_curso', 'Crítico', 'Luis Mora', -1, pg_temp.en(-1, '15:10'), pg_temp.en(-1, '20:30'));
select pg_temp.caso('INC0099002', 'GRUPO INTUR', 'CPE', 'Equipo del cliente sin gestión remota.',
                    'en_curso', null, 'Luis Mora', -1, pg_temp.en(-1, '16:00'), pg_temp.en(-1, '19:45'));
select pg_temp.caso('SCTASK0199001', 'UNITEC', 'SOPORTE DIGITAL', 'Ampliación de ancho de banda a 200 Mbps.',
                    'pausado', 'Pendiente cliente', 'Luis Mora', -1, pg_temp.en(-1, '16:40'), pg_temp.en(-1, '18:00'));
select pg_temp.caso('#SR0399001', 'CLIENTE RESIDENCIAL', 'FRESH', 'Cambio de contraseña de WiFi.',
                    'resuelto', null, 'Luis Mora', -1, pg_temp.en(-1, '17:30'), pg_temp.en(-1, '18:10'));

select pg_temp.traspaso('Luis Mora', -1, 'enviado', pg_temp.en(-1, '21:50'));
select pg_temp.traspasar(pg_temp.tr('Luis Mora', -1), v.codigo, v.para, v.destino, v.estado, v.etiqueta, v.descripcion,
                         pg_temp.en(-1, '21:50'), v.rec, v.texto)
from (values
  ('INC0099001',    'Tomás León', -1,   'en_curso', 'Crítico',           'Pérdida de paquetes intermitente hacia el DC secundario. Proveedor de tránsito revisando; pedir reporte a las 02:00.', null, null),
  ('INC0099002',    'Ana Pérez',    0,    'en_curso', 'Seguimiento',       'Equipo sin gestión remota. Cliente confirma energía estable; validar acceso por consola.', 0, 'Llamar al encargado de TI antes de las 10:00'),
  ('SCTASK0199001', 'Ana Pérez',    0,    'pausado',  'Pendiente cliente', 'Ampliación a 200 Mbps. El cliente confirma la ventana para pasado mañana.', 2, 'Ejecutar cambio en la ventana acordada'),
  ('#SR0399001',    null,                 null, 'cerrado',  null,                'Cambio de contraseña de WiFi realizado con el cliente en línea.', null, null)
) as v(codigo, para, destino, estado, etiqueta, descripcion, rec, texto);

-- Tomás (C) cerró turno de madrugada: lo recibido de Luis a Bruno (A) y su caso propio a Elena (comodín).
select pg_temp.caso('INC0099003', 'CLARO EMPRESAS', 'TX', 'Microcortes en fibra troncal San Pedro Sula - Puerto Cortés.',
                    'en_curso', 'Escalar', 'Tomás León', -1, pg_temp.en(-1, '23:20'), pg_temp.en(-1, '04:10'));
select pg_temp.traspaso('Tomás León', -1, 'enviado', pg_temp.en(-1, '05:50'));
select pg_temp.traspasar(pg_temp.tr('Tomás León', -1), v.codigo, v.para, 0, 'en_curso', v.etiqueta, v.descripcion,
                         pg_temp.en(-1, '05:50'))
from (values
  ('INC0099001', 'Bruno Díaz',     'Crítico', 'Pérdida de paquetes hacia el DC secundario. Tránsito cambió la ruta a las 02:30; monitorear la mañana.'),
  ('INC0099003', 'Elena Paz', 'Escalar', 'Microcortes en fibra troncal. Cuadrilla programada a las 08:00 en el km 34.')
) as v(codigo, para, etiqueta, descripcion);

-- ---------------------------------------------------------------------
-- 6. Hoy: tablero del día (lo que asignó el dispatch hoy), en todos los estados y tipos
--    Tipos: INC… = Incidente · SCTASK… = Tarea · #SR… / #INC… = FRESH · CHG… = Otro
-- ---------------------------------------------------------------------
select pg_temp.caso(v.codigo, v.cliente, v.area, v.descripcion, v.estado, v.etiqueta, v.tecnico, 0,
                    pg_temp.hace(v.asignado), case when v.actividad is not null then pg_temp.hace(v.actividad) end)
from (values
  -- Turno A
  ('INC0101001',    'BANCO ATLANTIDA',   'CORE IP',  'Agencia El Progreso sin enlace principal; opera por respaldo LTE.', 'en_curso', 'Crítico',  'Ana Pérez',   '11 hours'::interval, '9 hours'::interval),
  ('SCTASK0201001', 'DIUNSA',            'PLEX',     'Reprogramar IVR del call center.',                                    'resuelto', null,       'Ana Pérez',   '10 hours', '8 hours'),
  ('#SR0301001',    'CLIENTE RESIDENCIAL','FRESH',   'Cliente sin TV en 3 decodificadores.',                                'en_curso', null,       'Bruno Díaz',    '10 hours 30 minutes', '9 hours'),
  ('INC0101003',    'HOSPITAL VIERA',    'CPE',      'Switch del piso 2 con puertos en error.',                             'pausado',  'Pendiente cliente', 'Carla Rivas', '9 hours', '7 hours'),
  ('CHG0401001',    'OPERACION INTERNA', null,       null,                                                                   'en_curso', null,       'Carla Rivas',       '8 hours', null),
  -- Comodines
  ('#INC0301002',   'CLIENTE PYME',      'FRESH',    'Caída total de internet en local comercial.',                         'en_curso', 'Crítico',  'Elena Paz','9 hours 30 minutes', '6 hours'),
  ('INC0101004',    'ENEE',              'CORE CS',  'Llamadas entrantes rechazadas en troncal SIP.',                       'en_curso', 'Escalar',  'Hugo Ríos',     '7 hours', '5 hours'),
  ('INC0101005',    'ALCALDIA SPS',      'SIO',      'VM del portal ciudadano sin respuesta.',                              'en_curso', 'VM',       'Hugo Ríos',     '6 hours', '2 hours 30 minutes'),
  -- Turno B (las alertas de coordinación salen de estos si están en su turno)
  ('INC0101006',    'BAC CREDOMATIC',    'CORE IP',  'ATM sin comunicación en Mall Multiplaza.',                            'en_curso', null,       'Luis Mora',     '4 hours 30 minutes', null),
  ('SCTASK0201003', 'UNAH',              'SOPORTE DIGITAL', 'Habilitar VLAN para laboratorio.',                             'en_curso', 'Seguimiento', 'Luis Mora',  '1 hour', '20 minutes'),
  ('#SR0301003',    'CLIENTE RESIDENCIAL','FRESH',   'Velocidad menor a la contratada.',                                    'en_curso', null,       'Marta Ruiz',     '3 hours', null),
  ('INC0101008',    'PRICESMART',        'CPE',      'Firewall con CPU al 100%.',                                           'resuelto', 'Monitoreo','Marta Ruiz',     '2 hours', '40 minutes'),
  ('INC0101009',    'WALMART',           null,       null,                                                                   'en_curso', null,       'Pedro Lagos',  '2 hours 30 minutes', null),
  ('SCTASK0201004', 'LACTHOSA',          'REDPRO',   'Revisión de calidad de servicio en enlaces de planta.',               'pausado',  'Monitoreo','Pedro Lagos',  '1 hour 30 minutes', '1 hour')
) as v(codigo, cliente, area, descripcion, estado, etiqueta, tecnico, asignado, actividad);

-- Cerrados hoy (el tablero los muestra atenuados)
select pg_temp.caso('INC0101002', 'SEGUROS DEL PAIS', 'CORE PS', 'Usuarios sin datos móviles en APN corporativo. Se reinició la sesión del cliente.',
                    'cerrado', null, 'Bruno Díaz', 0, pg_temp.hace('10 hours'), pg_temp.hace('8 hours'));
select pg_temp.caso('SCTASK0201002', 'GRUPO KARIM', 'PVR', 'Respaldo de configuración de routers de borde.',
                    'cerrado', null, 'Elena Paz', 0, pg_temp.hace('9 hours'), pg_temp.hace('7 hours'));
select pg_temp.caso('INC0101010', 'COLONIA', 'REGIONAL', 'Corte de fibra en Choluteca restablecido por cuadrilla.',
                    'cerrado', null, 'Pedro Lagos', 0, pg_temp.hace('3 hours'), pg_temp.hace('1 hour 15 minutes'));

-- Bruno (A) ya cerró su turno de hoy: lo recibido de Tomás y su FRESH a turno B (mismo día).
select pg_temp.traspaso('Bruno Díaz', 0, 'enviado', pg_temp.hace('5 hours'));
select pg_temp.traspasar(pg_temp.tr('Bruno Díaz', 0), v.codigo, v.para, 0, 'en_curso', v.etiqueta, v.descripcion,
                         pg_temp.hace('5 hours'))
from (values
  ('INC0099001', 'Luis Mora', 'Crítico', 'Pérdida de paquetes hacia el DC secundario: estable desde las 09:00. Si no hay pérdida al cierre del turno, cerrar.'),
  ('#SR0301001', 'Marta Ruiz', null,      'Cliente sin TV en 3 decodificadores. Se reenviaron comandos; falta confirmar con el cliente.')
) as v(codigo, para, etiqueta, descripcion);

-- Pedro (B) tiene un borrador de traspaso a medio armar: incluye 1 de sus 2 casos abiertos (falta INC0101009,
-- que además no tiene descripción).
select pg_temp.traspaso('Pedro Lagos', 0, 'borrador', pg_temp.hace('15 minutes'));
insert into public.traspaso_items (traspaso_id, caso_id, para_tecnico_id, estado, etiqueta, descripcion)
select tr.id, c.id, pg_temp.tec('Tomás León'), c.estado, c.etiqueta, c.descripcion
from public.traspasos tr
join public.casos c on c.codigo = 'SCTASK0201004'
where tr.de_tecnico_id = pg_temp.tec('Pedro Lagos') and tr.estado = 'borrador';

-- Hugo: el dispatch canceló hoy un caso asignado por error (aviso "cancelado", sin caso).
insert into public.notificaciones (tecnico_id, tipo, caso_id, detalle, creado_en)
values (pg_temp.tec('Hugo Ríos'), 'cancelado', null, 'INC0101099', pg_temp.hace('4 hours'));
insert into public.bitacora (created_at, usuario_email, accion, codigo, tecnico, detalle)
values (pg_temp.hace('4 hours'), 'dispatch', 'caso_cancelado', 'INC0101099', 'Hugo Ríos', 'Código equivocado (datos de prueba)');

-- ---------------------------------------------------------------------
-- 7. Solicitudes de planificación (dispatch ↔ coordinación)
-- ---------------------------------------------------------------------
insert into public.solicitudes_planificacion
  (fecha_operativa, motivo, solicitante_id, solicitante_nombre, estado, respuesta, resuelta_por, resuelta_por_nombre,
   resuelta_en, vence_en, respuesta_vista, creada_en)
select v.fecha, v.motivo, d.id, coalesce(d.nombre, 'Dispatch'), v.estado, v.respuesta,
       case when v.estado <> 'pendiente' then c.id end,
       case when v.estado <> 'pendiente' then coalesce(c.nombre, 'Coordinación') end,
       case when v.estado <> 'pendiente' then v.creada + interval '25 minutes' end,
       case when v.estado = 'aprobada' then public.fin_del_dia_operativo() end,
       v.vista, v.creada
from (values
  (public.fecha_operativa() + 1, 'Raúl Vega pide cambiar su turno de mañana a turno A por una cita médica.', 'pendiente', null::text, false, now() - interval '30 minutes'),
  (public.fecha_operativa(),     'Mover el almuerzo de Pedro Lagos a las 19:30 por carga de casos.',    'aprobada',  'Aprobado solo por hoy.', false, now() - interval '3 hours'),
  (public.fecha_operativa() - 2, 'Agregar a Sofía Cruz en turno B para cubrir una ausencia.',              'rechazada', 'Ya está cubierto con el comodín.', true, pg_temp.en(-2, '09:00'))
) as v(fecha, motivo, estado, respuesta, vista, creada)
left join lateral (select id, nombre from public.perfiles where rol = 'dispatch' order by nombre limit 1) d on true
left join lateral (select id, nombre from public.perfiles where rol = 'coordinador' order by nombre limit 1) c on true;

-- ---------------------------------------------------------------------
-- 8. Avisos y alertas generados como lo haría el cron, historial y bitácora con fechas coherentes
-- ---------------------------------------------------------------------
select public.generar_recordatorios();           -- recordatorio de hoy de Ana (INC0099002)
select public.generar_alertas_coordinacion();    -- casos sin actualizar de quien está en turno ahora

-- Lo de días anteriores ya se vio; lo de hoy queda sin leer.
update public.notificaciones set leida = true where creado_en < pg_temp.en(0, '06:00');

-- La bitácora de cada caso con la hora en que se creó (los triggers la escriben con la hora de ejecución).
update public.bitacora b set created_at = c.creado_en
from public.casos c
where b.codigo = c.codigo and b.accion = 'caso_creado';

select public.generar_snapshot_operativo(public.fecha_operativa() - 3);
select public.generar_snapshot_operativo(public.fecha_operativa() - 2);
select public.generar_snapshot_operativo(public.fecha_operativa() - 1);

select set_config('app.origen', '', true);
select set_config('app.fecha_operativa', '', true);

alter table public.casos enable trigger casos_antes_de_guardar_trg;

commit;
