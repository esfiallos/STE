// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asignacionesDelDia, ORIGENES_DEL_TABLERO, type AsignacionDeCaso } from '../../src/domain/assignments';
import type { OrigenResponsable } from '../../src/types/noc';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';

describe('tablero del día (migración 11)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;
  let AYER: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const filas = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const idDe = async (codigo: string) => (await uno<{ id: string }>('select id from casos where codigo = $1', [codigo])).id;
  const tablero = async (fecha = D) =>
    (await filas<{ codigo: string; tecnico_asignado_id: string; estado: string }>(
      'select codigo, tecnico_asignado_id, estado from tablero_del_dia where fecha_operativa = $1 order by codigo', [fecha]
    ));

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const paso of [MIGRACIONES.esquema, MIGRACIONES.v3, MIGRACIONES.v4, MIGRACIONES.corte, MIGRACIONES.seguimiento,
      MIGRACIONES.traspasos, MIGRACIONES.coordinador, MIGRACIONES.ronda, MIGRACIONES.planificacion]) {
      await db.exec(paso());
    }
    await db.exec(MIGRACIONES.tableroDelDia());
    await db.exec(MIGRACIONES.tableroDelDia()); // se puede ejecutar dos veces
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    AYER = (await uno<{ d: string }>(`select ('${D}'::date - 1)::text d`)).d;

    await db.exec(`
      insert into tecnicos (id, nombre) values ('${ANA}','Ana Pérez'), ('${LUIS}','Luis Mora');
      insert into jornadas (fecha_operativa, tecnico_id, turno) select fecha_operativa(), id, turno_en_curso() from tecnicos;
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_COORD}'), ('${U_ANA}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch'), ('${U_COORD}','Coordinación','coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}','Ana','tecnico','${ANA}');
    `);

    // Ayer: un caso que asignó el dispatch y que hoy sigue abierto en manos de Ana.
    await db.exec(`select set_config('app.fecha_operativa', '${AYER}', false)`);
    await db.exec(`insert into casos (codigo, cliente, tecnico_actual_id) values ('INC-AYER', 'Vieja SA', '${ANA}')`);
    // Ayer, traspasado hoy a Luis (lo que haría enviar_traspaso).
    await db.exec(`insert into casos (codigo, tecnico_actual_id) values ('INC-TRASP', '${ANA}')`);
    await db.exec(`select set_config('app.fecha_operativa', '', false)`);
    await db.exec(`select set_config('app.origen', 'traspaso', false)`);
    await db.exec(`update casos set tecnico_actual_id = '${LUIS}' where codigo = 'INC-TRASP'`);
    await db.exec(`select set_config('app.origen', '', false)`);

    // Hoy: el dispatch asigna dos y reasigna uno.
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, cliente, tecnico_actual_id) values ('inc-1', ' ACME ', '${ANA}'), ('SCTASK-2', null, '${LUIS}')`);
    await db.exec(`update casos set tecnico_actual_id = '${LUIS}' where codigo = 'INC-1'`);
    await como(null);
  });

  it('los orígenes del tablero coinciden con el dominio', async () => {
    const { o } = await uno<{ o: string[] }>('select origenes_del_tablero() o');
    expect(o).toEqual([...ORIGENES_DEL_TABLERO]);
  });

  it('solo muestra lo que el dispatch asignó hoy, en la columna de su última asignación (igual que el dominio)', async () => {
    expect(await tablero()).toEqual([
      { codigo: 'INC-1', tecnico_asignado_id: LUIS, estado: 'en_curso' },
      { codigo: 'SCTASK-2', tecnico_asignado_id: LUIS, estado: 'en_curso' }
    ]);
    // Ayer queda con su propio registro
    expect((await tablero(AYER)).map((t) => t.codigo)).toEqual(['INC-AYER', 'INC-TRASP']);
    // Un día que aún no empieza está vacío
    expect(await tablero('2099-01-01')).toEqual([]);

    const responsables = await filas<{ caso_id: string; tecnico_id: string; fecha_operativa: string; origen: OrigenResponsable; desde: string }>(
      `select caso_id, tecnico_id, fecha_operativa::text, origen, to_char(desde at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') desde from caso_responsables`
    );
    const dominio = asignacionesDelDia(
      responsables.map<AsignacionDeCaso>((r) => ({ casoId: r.caso_id, tecnicoId: r.tecnico_id, fechaOperativa: r.fecha_operativa, origen: r.origen, desde: r.desde })),
      D
    );
    const vista = await filas<{ id: string; tecnico_asignado_id: string }>(`select id, tecnico_asignado_id from tablero_del_dia where fecha_operativa = '${D}'`);
    expect(new Map(vista.map((v) => [v.id, v.tecnico_asignado_id]))).toEqual(new Map([...dominio].map(([id, a]) => [id, a.tecnicoId])));
  });

  it('un cerrado sigue en el tablero del día y las estadísticas usan el mismo criterio', async () => {
    await como(U_ANA, 'ana@noc.test');
    await expect(db.exec(`update casos set estado = 'cerrado' where codigo = 'INC-AYER'`)).resolves.toBeDefined();
    await como(null);
    await db.exec(`update casos set estado = 'cerrado' where codigo = 'SCTASK-2'`);
    expect(await tablero()).toContainEqual({ codigo: 'SCTASK-2', tecnico_asignado_id: LUIS, estado: 'cerrado' });

    await como(U_COORD, 'coord@noc.test');
    const stats = await filas<{ estado: string; total: number }>('select * from estadisticas_del_dia() order by estado');
    expect(stats).toEqual([{ estado: 'cerrado', total: 1 }, { estado: 'en_curso', total: 1 }]);
    await como(null);
  });

  it('el dispatch no cierra casos; el técnico sí', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(db.exec(`update casos set estado = 'cerrado' where codigo = 'INC-1'`)).rejects.toThrow(/no cierra casos/);
    // Reabrir sí puede (asignar un código cerrado)
    await expect(db.exec(`update casos set estado = 'en_curso', tecnico_actual_id = '${ANA}' where codigo = 'INC-AYER'`)).resolves.toBeDefined();
    await como(null);
    expect((await tablero()).map((t) => t.codigo)).toContain('INC-AYER'); // la reapertura es del dispatch: entra al tablero de hoy
  });

  it('el dispatch corrige código y empresa; queda en la bitácora', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`update casos set codigo = 'sctask-22', cliente = 'Beta' where codigo = 'SCTASK-2'`);
    await como(null);
    const caso = await uno<{ codigo: string; cliente: string }>(`select codigo, cliente from casos where codigo = 'SCTASK-22'`);
    expect(caso).toEqual({ codigo: 'SCTASK-22', cliente: 'Beta' });
    const b = await uno<{ detalle: string }>(`select detalle from bitacora where accion = 'codigo_corregido' and codigo = 'SCTASK-22'`);
    expect(b.detalle).toBe('Antes: SCTASK-2');

    await como(U_ANA, 'ana@noc.test');
    await expect(db.exec(`update casos set codigo = 'X' where codigo = 'INC-AYER'`)).rejects.toThrow(/Solo el dispatch/);
    await como(null);
  });

  it('cancelar: solo el dispatch, solo casos de hoy y sin traspaso enviado; el técnico recibe aviso', async () => {
    const inc1 = await idDe('INC-1');
    await como(U_ANA, 'ana@noc.test');
    await expect(db.query('select cancelar_caso($1)', [inc1])).rejects.toThrow(/Solo el dispatch/);

    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(db.query('select cancelar_caso($1)', [await idDe('INC-TRASP')])).rejects.toThrow(/asignados hoy/);
    const { codigo } = await uno<{ codigo: string }>('select cancelar_caso($1, $2) codigo', [inc1, 'Código mal escrito']);
    expect(codigo).toBe('INC-1');
    await como(null);

    expect(await filas(`select 1 from casos where codigo = 'INC-1'`)).toHaveLength(0);
    expect(await filas(`select 1 from caso_responsables where caso_id = $1`, [inc1])).toHaveLength(0);
    const aviso = await uno<{ tecnico_id: string; caso_id: string | null; detalle: string }>(
      `select tecnico_id, caso_id, detalle from notificaciones where tipo = 'cancelado'`
    );
    expect(aviso).toEqual({ tecnico_id: LUIS, caso_id: null, detalle: 'INC-1' });
    const b = await uno<{ detalle: string; tecnico: string }>(`select detalle, tecnico from bitacora where accion = 'caso_cancelado'`);
    expect(b.tecnico).toBe('Luis Mora');
    expect(b.detalle).toContain('Motivo: Código mal escrito');
    expect(b.detalle).toContain('Empresa: ACME');

    // El código queda libre
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, tecnico_actual_id) values ('INC-1', '${ANA}')`);

    // Con un traspaso enviado ya no se puede cancelar
    await como(null);
    const t = await uno<{ id: string }>(`insert into traspasos (de_tecnico_id, fecha_operativa, estado) values ('${ANA}', '${D}', 'enviado') returning id`);
    await db.query('insert into traspaso_items (traspaso_id, caso_id, para_tecnico_id) values ($1, $2, $3)', [t.id, await idDe('INC-1'), LUIS]);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(db.query('select cancelar_caso($1)', [await idDe('INC-1')])).rejects.toThrow(/ya se traspasó/);
    await como(null);
  });

  it('la ronda guarda la empresa', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.query('select * from asignar_a_ronda($1, $2)', ['inc-ronda', 'Gamma']);
    await como(null);
    const caso = await uno<{ cliente: string; nota: string | null }>(`select cliente, nota from casos where codigo = 'INC-RONDA'`);
    expect(caso).toEqual({ cliente: 'Gamma', nota: null });
    expect((await tablero()).map((t) => t.codigo)).toContain('INC-RONDA');
  });

  it('la bitácora solo la leen dispatch y coordinación', async () => {
    await como(U_ANA, 'ana@noc.test');
    expect(await filas('select 1 from bitacora')).toHaveLength(0);
    await como(U_COORD, 'coord@noc.test');
    expect((await filas('select 1 from bitacora')).length).toBeGreaterThan(0);
    await como(U_DISPATCH, 'dispatch@noc.test');
    expect((await filas('select 1 from bitacora')).length).toBeGreaterThan(0);
    await como(null);
  });

  it('el snapshot del día guarda el tablero del día (con cerrados, sin traspasos)', async () => {
    await db.exec(`select generar_snapshot_operativo('${AYER}'::date)`);
    const { datos } = await uno<{ datos: { nombre: string; incidentes: { codigo: string; estado: string }[] }[] }>(
      `select datos_panel datos from historial_snapshots where fecha = '${AYER}'`
    );
    // Ayer no había jornadas: el snapshot queda vacío, pero no falla
    expect(datos).toEqual([]);

    await db.exec(`select generar_snapshot_operativo()`);
    const hoy = await uno<{ datos: { nombre: string; incidentes: { codigo: string }[] }[] }>(
      `select datos_panel datos from historial_snapshots where fecha = '${D}'`
    );
    const codigos = hoy.datos.flatMap((t) => t.incidentes.map((i) => i.codigo)).sort();
    expect(codigos).toEqual(['INC-1', 'INC-AYER', 'INC-RONDA', 'SCTASK-22']);
  });
});
