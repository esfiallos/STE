// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_DISPATCH2 = 'd0000000-0000-0000-0000-000000000002';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const T_ANA = '22222222-2222-2222-2222-222222222222';
const T_BETO = '33333333-3333-3333-3333-333333333333';

interface Cambio {
  por: string;
  tecnico: string;
  antes: string;
  despues: string;
}

describe('planificación con aviso (migración 18, D38)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let HOY: string;
  let AYER: string;
  let MANANA: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  /** Igual que la app: upsert de la jornada. */
  const planificar = (fecha: string, tecnico = T_BETO, turno = 'turnoB') =>
    db.query(
      `insert into jornadas (fecha_operativa, tecnico_id, turno) values ($1, $2, $3)
       on conflict (fecha_operativa, tecnico_id) do update set turno = excluded.turno`,
      [fecha, tecnico, turno]
    );
  const avisar = async (fecha: string, motivo = 'Falta un técnico') =>
    (await uno<{ id: string }>('select avisar_cambio_planificacion($1, $2) id', [fecha, motivo])).id;
  const cambiosDe = async (id: string) => (await uno<{ cambios: Cambio[] }>('select cambios from avisos_planificacion where id = $1', [id])).cambios;

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const m of ['esquema', 'v3', 'v4', 'corte', 'seguimiento', 'traspasos', 'coordinador', 'ronda', 'planificacion',
                     'tableroDelDia', 'seguimientoDescripcion', 'filtros', 'turnoC', 'traspasoPropio', 'proteccion',
                     'entregaSupervision'] as const) {
      await db.exec(MIGRACIONES[m]());
    }
    await db.exec(MIGRACIONES.planificacionConAviso());
    await db.exec(MIGRACIONES.planificacionConAviso()); // se puede ejecutar dos veces
    como = actuarComo(db);
    ({ hoy: HOY, ayer: AYER, manana: MANANA } = await uno<{ hoy: string; ayer: string; manana: string }>(
      `select fecha_operativa()::text hoy, (fecha_operativa() - 1)::text ayer, (fecha_operativa() + 1)::text manana`
    ));
    await db.exec(`
      insert into tecnicos (id, nombre) values ('${T_ANA}', 'Ana Pérez'), ('${T_BETO}', 'Beto Ruiz');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values
        ('${AYER}', '${T_ANA}', 'turnoA'), ('${HOY}', '${T_ANA}', 'turnoA'), ('${HOY}', '${T_BETO}', 'turnoB');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_DISPATCH2}'), ('${U_COORD}'), ('${U_ANA}');
      insert into perfiles (id, nombre, rol) values
        ('${U_DISPATCH}', 'Dispatch Uno', 'dispatch'), ('${U_DISPATCH2}', 'Dispatch Dos', 'dispatch'), ('${U_COORD}', 'Coordinación', 'coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}', 'Ana', 'tecnico', '${T_ANA}');
    `);
  });

  it('el dispatch puede planificar, pero el primer cambio de un día pide el motivo; el almuerzo no', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    expect((await uno<{ p: boolean }>('select puede_planificar($1) p', [MANANA])).p).toBe(true);
    await expect(planificar(MANANA)).rejects.toThrow(/indica el motivo del cambio/);
    await expect(db.query(`delete from jornadas where fecha_operativa = $1 and tecnico_id = $2`, [HOY, T_BETO])).rejects.toThrow(/motivo/);
    // Almuerzo, y guardar el mismo turno, sin motivo
    await db.query(`update jornadas set almuerzo_inicio = '18:00', almuerzo_fin = '18:30' where fecha_operativa = $1 and tecnico_id = $2`, [HOY, T_BETO]);
    await planificar(HOY, T_BETO, 'turnoB');
    await como(null);
    const j = await uno<{ almuerzo_inicio: string; turno: string }>(
      `select almuerzo_inicio::text, turno from jornadas where fecha_operativa = $1 and tecnico_id = $2`,
      [HOY, T_BETO]
    );
    expect(j).toEqual({ almuerzo_inicio: '18:00:00', turno: 'turnoB' });
    expect((await db.query('select 1 from avisos_planificacion')).rows).toHaveLength(0);
  });

  it('con el motivo dado, edita ese día libre y cada cambio queda anotado (antes → después, quién)', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(avisar(MANANA, '   ')).rejects.toThrow(/motivo/);
    await expect(avisar(AYER)).rejects.toThrow(/ya pasó/);
    const id = await avisar(MANANA, '  Beto se reportó enfermo ');
    expect(await avisar(MANANA, 'Otro motivo')).toBe(id); // una vez por día

    await planificar(MANANA, T_BETO, 'turnoB'); // Libre → B
    await planificar(MANANA, T_BETO, 'turnoA'); // upsert: B → A (una sola anotación)
    await como(U_DISPATCH2, 'dispatch2@noc.test');
    await db.query('delete from jornadas where fecha_operativa = $1 and tecnico_id = $2', [MANANA, T_BETO]); // A → Libre
    // Otro día sigue pidiendo su propio motivo
    await expect(planificar(HOY, T_BETO, 'turnoA')).rejects.toThrow(/motivo/);

    await como(null);
    const a = await uno<{ motivo: string; autor_nombre: string; vence_ok: boolean; visto: boolean }>(
      `select motivo, autor_nombre, vence_en = fin_del_dia_operativo() vence_ok, visto from avisos_planificacion where id = $1`,
      [id]
    );
    expect(a).toEqual({ motivo: 'Beto se reportó enfermo', autor_nombre: 'Dispatch Uno', vence_ok: true, visto: false });
    expect((await cambiosDe(id)).map(({ por, tecnico, antes, despues }) => ({ por, tecnico, antes, despues }))).toEqual([
      { por: 'Dispatch Uno', tecnico: 'Beto Ruiz', antes: 'Libre', despues: 'Turno B' },
      { por: 'Dispatch Uno', tecnico: 'Beto Ruiz', antes: 'Turno B', despues: 'Turno A' },
      { por: 'Dispatch Dos', tecnico: 'Beto Ruiz', antes: 'Turno A', despues: 'Libre' }
    ]);
    expect((await db.query(`select 1 from bitacora where accion = 'aviso_planificacion'`)).rows).toHaveLength(1);
  });

  it('al terminar el día operativo el motivo vence y hay que darlo otra vez', async () => {
    await como(null);
    await db.query(`update avisos_planificacion set vence_en = now() - interval '1 minute' where fecha_operativa = $1`, [MANANA]);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(planificar(MANANA)).rejects.toThrow(/motivo/);
    await avisar(MANANA, 'Nuevo ajuste');
    await planificar(MANANA);
    await como(null);
    expect((await db.query('select 1 from avisos_planificacion where fecha_operativa = $1', [MANANA])).rows).toHaveLength(2);
  });

  it('coordinación planifica sin motivo, lee los avisos y solo puede marcarlos vistos; el técnico no ve ni edita', async () => {
    await como(U_COORD, 'coord@noc.test');
    await planificar(MANANA, T_ANA, 'turnoB');
    await expect(planificar(AYER)).rejects.toThrow(/ya pasó/);
    const { id } = await uno<{ id: string }>('select id from avisos_planificacion order by creado_en limit 1');
    await db.query('update avisos_planificacion set visto = true where id = $1', [id]);
    await expect(db.query(`update avisos_planificacion set motivo = 'x' where id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into avisos_planificacion (fecha_operativa, motivo, vence_en) values ($1, 'x', now())`, [HOY])
    ).rejects.toThrow(/permission denied/);
    await expect(avisar(MANANA)).rejects.toThrow(/Solo el dispatch/);
    expect((await uno<{ visto: boolean }>('select visto from avisos_planificacion where id = $1', [id])).visto).toBe(true);

    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.query('update avisos_planificacion set visto = true');
    await como(null);
    expect((await db.query('select 1 from avisos_planificacion where visto')).rows).toHaveLength(1); // el dispatch no marca

    await como(U_ANA, 'ana@noc.test');
    expect((await db.query('select 1 from avisos_planificacion')).rows).toHaveLength(0);
    await expect(planificar(MANANA)).rejects.toThrow(/row-level security|planifican/);
    await como(null);
  });

  it('un cambio nuevo vuelve a mostrar el aviso a coordinación; las solicitudes de la 10 se retiran', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await planificar(MANANA, T_BETO, 'turnoA');
    await como(null);
    expect(
      (await uno<{ visto: boolean }>(`select visto from avisos_planificacion where fecha_operativa = $1 and vence_en > now()`, [MANANA])).visto
    ).toBe(false);
    expect(
      (await db.query(`select 1 from pg_proc where proname in ('solicitar_edicion_planificacion', 'resolver_solicitud_planificacion')`)).rows
    ).toHaveLength(0);
  });
});
