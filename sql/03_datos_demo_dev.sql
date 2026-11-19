
-- =====================================================================
-- Panel NOC · datos de demostración SOLO PARA LA BASE DE DESARROLLO (modelo v2)
-- Requiere 01, 02, 04 y 05.
--
-- ATENCIÓN: borra jornadas, casos, traspasos, notificaciones, bitácora y snapshots y los reemplaza
-- por datos de prueba. NO toca `perfiles` (tus usuarios y roles) ni borra técnicos: agrega los de
-- demostración si faltan.
--
-- Protección contra accidentes: este script se niega a ejecutarse si la base no tiene
-- la tabla marcadora "entorno_dev". Créala UNA SOLA VEZ, únicamente en la base de DESARROLLO:
--
--     create table public.entorno_dev (id int);
--
-- La base de producción no tiene esa tabla, así que aquí el script falla sin tocar nada.
-- =====================================================================

do $$
begin
  if to_regclass('public.entorno_dev') is null then
    raise exception 'Esta NO es la base de desarrollo (falta la tabla public.entorno_dev). No se hizo ningún cambio.';
  end if;
end;
$$;

begin;

delete from public.notificaciones;
delete from public.traspaso_items;
delete from public.traspasos;
delete from public.caso_responsables;
delete from public.casos;
delete from public.jornadas;
truncate public.bitacora;
truncate public.historial_snapshots;

insert into public.tecnicos (nombre)
select v.nombre
from (values ('Ana Pérez'), ('Bruno Díaz'), ('Luis Mora'), ('Carla Rivas'), ('Diego Núñez'), ('Marta Soto')) as v(nombre)
on conflict (lower(btrim(nombre))) do update set activo = true;

-- Planificación de toda la semana actual (lunes a domingo del día operativo de hoy)
insert into public.jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin, almuerzo_inicio, almuerzo_fin)
select d::date, t.id, v.turno, v.hi::time, v.hf::time, v.ai::time, v.af::time
from (values
  ('Ana Pérez',   'turnoA',  null,    null,    '12:00', '12:30'),
  ('Bruno Díaz',  'turnoA',  null,    null,    '12:30', '13:00'),
  ('Luis Mora',   'turnoB',  null,    null,    '18:00', '18:30'),
  ('Carla Rivas', 'turnoB',  null,    null,    null,    null),
  ('Diego Núñez', 'turnoC',  null,    null,    '02:00', '02:30'),
  ('Marta Soto',  'comodin', '08:00', '18:00', '13:00', '13:30')
) as v(nombre, turno, hi, hf, ai, af)
join public.tecnicos t on lower(btrim(t.nombre)) = lower(btrim(v.nombre))
cross join generate_series(
  date_trunc('week', public.fecha_operativa()::timestamp),
  date_trunc('week', public.fecha_operativa()::timestamp) + interval '6 days',
  interval '1 day') as d;

insert into public.casos (codigo, cliente, area, descripcion, nota, tecnico_actual_id)
select v.codigo, v.cliente, v.area, v.descripcion, v.nota, t.id
from (values
  ('INC100001', 'BANCO ATLÁNTIDA', 'ENLACES B2B', 'Monitoreo enlace fibra',          'P2',                    'Ana Pérez'),
  ('INC100002', 'GRUPO INTUR',     'DATACENTER',  'Reglas de firewall VPN',          null,                    'Ana Pérez'),
  ('INC100003', 'FICOHSA',         'SOPORTE N2',  'Cliente B2B sin servicio',        'Escalar',               'Bruno Díaz'),
  ('INC100004', 'DIUNSA',          'TRANSPORTE',  'Revisión de latencia en el core', null,                    'Luis Mora'),
  ('SCTASK2001','UNITEC',          'CLOUD / B2B', 'Ampliación de ancho de banda',    null,                    'Marta Soto'),
  ('INC100006', 'CARGILL',         'ENLACES B2B', 'Cambio programado 22:00',         'Ventana de mantenimiento', 'Diego Núñez')
) as v(codigo, cliente, area, descripcion, nota, tecnico)
join public.tecnicos t on lower(btrim(t.nombre)) = lower(btrim(v.tecnico));

-- Un snapshot de "ayer" para poder probar la pestaña Historial
select public.generar_snapshot_operativo(public.fecha_operativa() - 1);

commit;
