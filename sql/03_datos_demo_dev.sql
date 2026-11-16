-- =====================================================================
-- Panel NOC · datos de demostración SOLO PARA LA BASE DE DESARROLLO
--
-- ATENCIÓN: borra técnicos, incidentes, bitácora y snapshots y los reemplaza por datos de prueba.
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

truncate public.incidentes, public.tecnicos cascade;
truncate public.bitacora;
truncate public.historial_snapshots;

insert into public.tecnicos (nombre, turno, horario_inicio, horario_fin, almuerzo_inicio, almuerzo_fin) values
  ('Ana Pérez',    'turnoA',  null,    null,    '12:00', '12:30'),
  ('Bruno Díaz',   'turnoA',  null,    null,    '12:30', '13:00'),
  ('Luis Mora',    'turnoB',  null,    null,    '18:00', '18:30'),
  ('Carla Rivas',  'turnoB',  null,    null,    null,    null),
  ('Diego Núñez',  'turnoC',  null,    null,    '02:00', '02:30'),
  ('Marta Soto',   'comodin', '08:00', '18:00', '13:00', '13:30');

insert into public.incidentes (codigo, nota, tecnico_id)
select v.codigo, v.nota, t.id
from (values
  ('INC100001', 'P2 - Monitoreo enlace fibra',        'Ana Pérez'),
  ('INC100002', null,                                  'Ana Pérez'),
  ('INC100003', 'Cliente B2B sin servicio, escalar',   'Bruno Díaz'),
  ('INC100004', 'Revisión de latencia en el core',     'Luis Mora'),
  ('INC100005', null,                                  'Marta Soto'),
  ('INC100006', 'Cambio programado 22:00',             'Diego Núñez')
) as v(codigo, nota, tecnico)
join public.tecnicos t on t.nombre = v.tecnico;

-- Un snapshot de "ayer" para poder probar la pestaña Historial
select public.generar_snapshot_diario((now() at time zone 'America/Tegucigalpa')::date - 1);

commit;
