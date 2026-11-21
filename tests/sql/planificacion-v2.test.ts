// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const T_ANA = '22222222-2222-2222-2222-222222222222';
const T_BETO = '33333333-3333-3333-3333-333333333333';

describe('planificación con solicitudes (migración 10)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let HOY: string;
  let AYER: string;
  let MANANA: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const planificar = (fecha: string, tecnico = T_BETO, turno = 'turnoB') =>
    db.query(
      `insert into jornadas (fecha_operativa, tecnico_id, turno) values ($1, $2, $3)
       on conflict (fecha_operativa, tecnico_id) do update set turno = excluded.turno`,
      [fecha, tecnico, turno]
    );
  const solicitar = async (fecha: string, motivo = 'Falta un técnico') =>
    (await uno<{ id: string }>('select solicitar_edicion_planificacion($1, $2) id', [fecha, motivo])).id;
  const resolver = (id: string, aprobar: boolean, respuesta: string | null = null) =>
    db.query('select resolver_solicitud_planificacion($1, $2, $3)', [id, aprobar, respuesta]);

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const paso of [
      MIGRACIONES.esquema, MIGRACIONES.v3, MIGRACIONES.v4, MIGRACIONES.corte, MIGRACIONES.seguimiento,
      MIGRACIONES.traspasos, MIGRACIONES.coordinador, MIGRACIONES.ronda
    ]) {
      await db.exec(paso());
    }
    await db.exec(MIGRACIONES.planificacion());
    await db.exec(MIGRACIONES.planificacion()); // se puede ejecutar dos veces
    como = actuarComo(db);
    ({ hoy: HOY, ayer: AYER, manana: MANANA } = await uno<{ hoy: string; ayer: string; manana: string }>(
      `select fecha_operativa()::text hoy, (fecha_operativa() - 1)::text ayer, (fecha_operativa() + 1)::text manana`
    ));
    await db.exec(`
      insert into tecnicos (id, nombre) values ('${T_ANA}', 'Ana Pérez'), ('${T_BETO}', 'Beto Ruiz');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${AYER}', '${T_ANA}', 'turnoA'), ('${HOY}', '${T_ANA}', 'turnoA');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_COORD}'), ('${U_ANA}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}', 'Dispatch Uno', 'dispatch'), ('${U_COORD}', 'Coordinación', 'coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}', 'Ana', 'tecnico', '${T_ANA}');
    `);
  });

  it('coordinación planifica de hoy en adelante; nadie toca días pasados', async () => {
    await como(U_COORD, 'coord@noc.test');
    await planificar(HOY);
    await planificar(MANANA, T_BETO, 'turnoC');
    await db.query(`update jornadas set almuerzo_inicio = '18:00', almuerzo_fin = '18:30' where fecha_operativa = $1 and tecnico_id = $2`, [HOY, T_BETO]);
    await expect(planificar(AYER)).rejects.toThrow(/ya pasó/);
    // Las filas de días pasados ni siquiera se ven para editar o borrar (RLS): no cambian
    await db.query(`update jornadas set turno = 'turnoC' where fecha_operativa = $1`, [AYER]);
    await db.query(`delete from jornadas where fecha_operativa = $1`, [AYER]);
    await como(null);
    expect((await uno<{ turno: string }>(`select turno from jornadas where fecha_operativa = $1`, [AYER])).turno).toBe('turnoA');
  });

  it('para el dispatch la planificación es de solo lectura sin permiso; el técnico tampoco edita', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    expect((await uno<{ p: boolean }>('select puede_planificar($1) p', [HOY])).p).toBe(false);
    await expect(planificar(HOY, T_BETO, 'turnoA')).rejects.toThrow(/pide permiso a coordinación/);
    await expect(db.query(`update jornadas set almuerzo_inicio = null, almuerzo_fin = null where fecha_operativa = $1`, [HOY])).rejects.toThrow(
      /pide permiso a coordinación/
    );
    await expect(db.query(`delete from jornadas where fecha_operativa = $1 and tecnico_id = $2`, [HOY, T_BETO])).rejects.toThrow(/pide permiso/);
    await como(U_ANA, 'ana@noc.test');
    await expect(planificar(MANANA)).rejects.toThrow(/row-level security|pide permiso/);
    await como(null);
  });

  it('el dispatch pide permiso, coordinación aprueba y solo ese día queda editable hasta el fin del día operativo', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(solicitar(MANANA, '   ')).rejects.toThrow(/motivo/);
    await expect(solicitar(AYER)).rejects.toThrow(/ya pasó/);
    const id = await solicitar(MANANA, '  Beto se reportó enfermo ');
    await expect(solicitar(MANANA)).rejects.toThrow(/pendiente/);
    await expect(resolver(id, true)).rejects.toThrow(/Solo coordinación/);

    await como(U_COORD, 'coord@noc.test');
    await resolver(id, true, 'Adelante');
    await expect(resolver(id, false)).rejects.toThrow(/ya fue respondida/);
    const s = await uno<{ estado: string; motivo: string; solicitante_nombre: string; resuelta_por_nombre: string; vence_ok: boolean }>(
      `select estado, motivo, solicitante_nombre, resuelta_por_nombre, vence_en = fin_del_dia_operativo() vence_ok
       from solicitudes_planificacion where id = $1`,
      [id]
    );
    expect(s).toEqual({ estado: 'aprobada', motivo: 'Beto se reportó enfermo', solicitante_nombre: 'Dispatch Uno', resuelta_por_nombre: 'Coordinación', vence_ok: true });

    await como(U_DISPATCH, 'dispatch@noc.test');
    await planificar(MANANA, T_BETO, 'turnoA');
    await expect(planificar(HOY, T_BETO, 'turnoA')).rejects.toThrow(/pide permiso/); // otro día sigue bloqueado
    await expect(solicitar(MANANA)).rejects.toThrow(/ya está habilitado/);
    // Marca la respuesta como vista; no puede cambiar nada más de la solicitud
    await db.query(`update solicitudes_planificacion set respuesta_vista = true where id = $1`, [id]);
    await expect(db.query(`update solicitudes_planificacion set estado = 'aprobada' where id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(db.query(`insert into solicitudes_planificacion (fecha_operativa, motivo) values ($1, 'x')`, [HOY])).rejects.toThrow(/permission denied/);

    // Al vencer la aprobación, el día vuelve a ser de solo lectura
    await como(null);
    await db.query(`update solicitudes_planificacion set vence_en = now() - interval '1 minute' where id = $1`, [id]);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(planificar(MANANA, T_BETO, 'turnoB')).rejects.toThrow(/pide permiso/);
    await como(null);
    expect((await db.query(`select 1 from bitacora where accion like 'solicitud_planificacion%'`)).rows).toHaveLength(2);
  });

  it('una solicitud rechazada no habilita el día; leen dispatch y coordinación, no el técnico', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    const id = await solicitar(HOY, 'Cambio de almuerzo');
    await como(U_COORD, 'coord@noc.test');
    await resolver(id, false, 'Hoy no');
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(planificar(HOY, T_BETO, 'turnoA')).rejects.toThrow(/pide permiso/);
    expect((await db.query('select 1 from solicitudes_planificacion')).rows).toHaveLength(2);
    await como(U_ANA, 'ana@noc.test');
    expect((await db.query('select 1 from solicitudes_planificacion')).rows).toHaveLength(0);
    await expect(solicitar(MANANA)).rejects.toThrow(/Solo el dispatch/);
    await como(null);
  });

  it('el fin del día operativo es a las 06:00 de Honduras del día siguiente', async () => {
    const { fin } = await uno<{ fin: string }>(
      `select to_char(fin_del_dia_operativo('2026-11-09 03:00-06'::timestamptz) at time zone 'America/Tegucigalpa', 'YYYY-MM-DD HH24:MI') fin`
    );
    expect(fin).toBe('2026-11-09 06:00');
    const { fin: fin2 } = await uno<{ fin: string }>(
      `select to_char(fin_del_dia_operativo('2026-11-09 07:00-06'::timestamptz) at time zone 'America/Tegucigalpa', 'YYYY-MM-DD HH24:MI') fin`
    );
    expect(fin2).toBe('2026-11-10 06:00');
  });
});
