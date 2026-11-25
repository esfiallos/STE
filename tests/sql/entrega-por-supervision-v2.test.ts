// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const LUIS = '22222222-2222-2222-2222-222222222222';
const MARTA = '33333333-3333-3333-3333-333333333333';
const PEDRO = '44444444-4444-4444-4444-444444444444';

describe('entrega de casos por supervisión (migración 17)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;
  let MANANA: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const idDe = async (codigo: string) => (await uno<{ id: string }>('select id from casos where codigo = $1', [codigo])).id;
  const entrega = async (codigo: string, tecnico: string, fecha: string) => ({ caso: await idDe(codigo), tecnico, fecha });
  const entregar = (entregas: unknown[]) => db.query<{ n: number }>('select entregar_casos($1::jsonb) n', [JSON.stringify(entregas)]);
  /** La interna, con la hora fija, como administrador con el JWT de un usuario (para probar "ya terminó su turno"). */
  const entregarALas = async (uid: string, entregas: unknown[], ahora: string) => {
    await como(null);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid, JSON.stringify({ sub: uid, email: 'x@noc.test' })]);
    return db.query<{ n: number }>('select entregar_casos_en($1::jsonb, $2::timestamptz) n', [JSON.stringify(entregas), ahora]);
  };

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const m of ['esquema', 'v3', 'v4', 'corte', 'seguimiento', 'traspasos', 'coordinador', 'ronda', 'planificacion',
                     'tableroDelDia', 'seguimientoDescripcion', 'filtros', 'turnoC', 'traspasoPropio', 'proteccion'] as const) {
      await db.exec(MIGRACIONES[m]());
    }
    await db.exec(MIGRACIONES.entregaSupervision());
    await db.exec(MIGRACIONES.entregaSupervision()); // se puede ejecutar dos veces
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    MANANA = (await uno<{ d: string }>(`select ('${D}'::date + 1)::text d`)).d;

    await db.exec(`
      insert into tecnicos (id, nombre) values ('${LUIS}','Luis'), ('${MARTA}','Marta'), ('${PEDRO}','Pedro');
      -- Luis: A hoy y A mañana · Marta: A mañana · Pedro: nada
      insert into jornadas (fecha_operativa, tecnico_id, turno) values
        ('${D}','${LUIS}','turnoA'), ('${MANANA}','${LUIS}','turnoA'), ('${MANANA}','${MARTA}','turnoA');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_COORD}'), ('${U_LUIS}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch'), ('${U_COORD}','Coord','coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_LUIS}','Luis','tecnico','${LUIS}');
    `);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, descripcion, tecnico_actual_id) values
      ('INC1','Uno','${PEDRO}'), ('INC2','Dos','${PEDRO}'), ('INC3','Tres','${LUIS}'), ('INC4','Cuatro','${PEDRO}')`);
  });

  it('el dispatch reparte: el caso pasa al seguimiento de quien recibe (traspaso, mañana), con aviso y bitácora', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    const r = await entregar([await entrega('INC1', MARTA, MANANA)]);
    expect(Number(r.rows[0]!.n)).toBe(1);

    await como(null);
    expect(await uno(`select tecnico_actual_id t, fecha_responsable::text f, origen_responsable o from casos_abiertos where codigo = 'INC1'`))
      .toEqual({ t: MARTA, f: MANANA, o: 'traspaso' });
    // No entra al tablero del día (D16): es un traspaso, no una asignación del dispatch
    expect(await uno(`select count(*)::int n from tablero_del_dia where codigo = 'INC1' and fecha_operativa = '${MANANA}'`)).toEqual({ n: 0 });
    expect(await uno(`select tipo, detalle from notificaciones where tecnico_id = '${MARTA}'`)).toEqual({ tipo: 'traspaso', detalle: 'INC1' });
    expect(await uno(`select usuario_email, tecnico, detalle from bitacora where accion = 'entregado_por_supervision'`)).toEqual({
      usuario_email: 'dispatch@noc.test', tecnico: 'Marta', detalle: `Entregado a Marta para su turno del ${MANANA.slice(8, 10)}/${MANANA.slice(5, 7)}`
    });
  });

  it('coordinación también puede; un técnico no', async () => {
    await como(U_COORD, 'coord@noc.test');
    expect(Number((await entregar([await entrega('INC2', MARTA, MANANA)])).rows[0]!.n)).toBe(1);

    await como(U_LUIS, 'luis@noc.test');
    await expect(entregar([await entrega('INC4', LUIS, MANANA)])).rejects.toThrow('Solo el dispatch o coordinación pueden entregar casos.');
  });

  it('el mismo técnico puede quedarse el caso para su turno de mañana (nuevo tramo)', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await entregar([await entrega('INC3', LUIS, MANANA)]);
    await como(null);
    expect(await uno(`select tecnico_actual_id t, fecha_responsable::text f from casos_abiertos where codigo = 'INC3'`)).toEqual({ t: LUIS, f: MANANA });
    expect(await uno(`select count(*)::int n from caso_responsables where caso_id = $1`, [await idDe('INC3')])).toEqual({ n: 2 });

    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(entregar([await entrega('INC3', LUIS, MANANA)])).rejects.toThrow('El caso INC3 ya es de Luis para ese día.');
  });

  it('rechaza receptores sin jornada ese día, fechas fuera de hoy/mañana y turnos ya terminados; todo o nada', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(entregar([await entrega('INC4', PEDRO, MANANA)])).rejects.toThrow('Quien recibe INC4 no está planificado ese día.');
    await expect(entregar([await entrega('INC4', MARTA, D)])).rejects.toThrow('Quien recibe INC4 no está planificado ese día.');
    const pasado = (await uno<{ d: string }>(`select ('${D}'::date - 1)::text d`)).d;
    await expect(entregar([await entrega('INC4', LUIS, pasado)])).rejects.toThrow('El caso INC4 solo se puede entregar para hoy o mañana.');

    // Todo o nada: la segunda falla, la primera tampoco queda
    await expect(entregar([await entrega('INC4', MARTA, MANANA), await entrega('INC1', PEDRO, MANANA)])).rejects.toThrow();
    await como(null);
    expect(await uno(`select tecnico_actual_id t from casos where codigo = 'INC4'`)).toEqual({ t: PEDRO });

    // Luis (turno A hoy) a las 15:00 de hoy ya terminó su turno
    const tarde = (await uno<{ t: string }>(`select ((('${D}'::date) + time '15:00')::timestamp at time zone 'America/Tegucigalpa')::text t`)).t;
    await expect(entregarALas(U_DISPATCH, [await entrega('INC4', LUIS, D)], tarde)).rejects.toThrow('Luis ya terminó su turno: elige a otra persona para INC4.');
    const manana = (await uno<{ t: string }>(`select ((('${D}'::date) + time '09:00')::timestamp at time zone 'America/Tegucigalpa')::text t`)).t;
    expect(Number((await entregarALas(U_DISPATCH, [await entrega('INC4', LUIS, D)], manana)).rows[0]!.n)).toBe(1);
  });

  it('la interna no se puede llamar desde la app', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(db.query(`select entregar_casos_en('[]'::jsonb, now())`)).rejects.toThrow(/permission denied/);
  });
});
