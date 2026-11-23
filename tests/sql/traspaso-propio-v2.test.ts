// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const U_PEDRO = 'a0000000-0000-0000-0000-000000000003';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';
const MARTA = '33333333-3333-3333-3333-333333333333';
const PEDRO = '44444444-4444-4444-4444-444444444444';

describe('quedarse un caso para mañana (migración 15)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;
  let MANANA: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const n = async (sql: string, params: unknown[] = []) => (await uno<{ n: number }>(sql, params)).n;
  const idDe = async (codigo: string) => (await uno<{ id: string }>('select id from casos where codigo = $1', [codigo])).id;

  /** Borrador del técnico con un ítem por caso: [código, para quién]. Devuelve el id del traspaso. */
  async function borrador(de: string, items: [string, string][]): Promise<string> {
    await como(null);
    const { id } = await uno<{ id: string }>(
      `insert into traspasos (de_tecnico_id, fecha_operativa) values ($1, $2) returning id`, [de, D]
    );
    for (const [codigo, para] of items) {
      await db.query(
        `insert into traspaso_items (traspaso_id, caso_id, para_tecnico_id, estado, descripcion) values ($1, $2, $3, 'en_curso', 'Sigue')`,
        [id, await idDe(codigo), para]
      );
    }
    return id;
  }

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const m of ['esquema', 'v3', 'v4', 'corte', 'seguimiento', 'traspasos', 'coordinador', 'ronda', 'planificacion',
                     'tableroDelDia', 'seguimientoDescripcion', 'filtros', 'turnoC'] as const) {
      await db.exec(MIGRACIONES[m]());
    }
    await db.exec(MIGRACIONES.traspasoPropio());
    await db.exec(MIGRACIONES.traspasoPropio()); // se puede ejecutar dos veces
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    MANANA = (await uno<{ d: string }>(`select ('${D}'::date + 1)::text d`)).d;

    await db.exec(`
      insert into tecnicos (id, nombre) values ('${ANA}','Ana'), ('${LUIS}','Luis'), ('${MARTA}','Marta'), ('${PEDRO}','Pedro');
      -- Ana: comodín hoy y mañana · Luis: B hoy · Marta: A mañana · Pedro: A hoy y nada mañana
      insert into jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin) values
        ('${D}','${ANA}','comodin','07:00','17:00'), ('${MANANA}','${ANA}','comodin','07:00','17:00');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values
        ('${D}','${LUIS}','turnoB'), ('${MANANA}','${MARTA}','turnoA'), ('${D}','${PEDRO}','turnoA');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_ANA}'), ('${U_LUIS}'), ('${U_PEDRO}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch');
      insert into perfiles (id, nombre, rol, tecnico_id) values
        ('${U_ANA}','Ana','tecnico','${ANA}'), ('${U_LUIS}','Luis','tecnico','${LUIS}'), ('${U_PEDRO}','Pedro','tecnico','${PEDRO}');
    `);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, descripcion, tecnico_actual_id) values
      ('INC1','Uno','${ANA}'), ('INC2','Dos','${ANA}'), ('INC9','Nueve','${LUIS}'), ('INC5','Cinco','${PEDRO}')`);
    await como(null);
  });

  it('lo que otro te entrega para mañana no impide cerrar tu turno de hoy', async () => {
    const t = await borrador(LUIS, [['INC9', ANA]]); // B → comodín de mañana
    await como(U_LUIS, 'luis@noc.test');
    expect(await n('select enviar_traspaso($1) n', [t])).toBe(1);
    await como(null);
    expect(await uno(`select tecnico_actual_id t, fecha_responsable::text f from casos_abiertos where codigo = 'INC9'`))
      .toEqual({ t: ANA, f: MANANA });
  });

  it('un técnico no puede quedarse un caso si mañana no tiene un turno que reciba del suyo', async () => {
    const t = await borrador(PEDRO, [['INC5', PEDRO]]);
    await como(U_PEDRO, 'pedro@noc.test');
    await expect(db.query('select enviar_traspaso($1)', [t])).rejects.toThrow(/INC5 solo puede quedarse contigo/);
    await como(null);
  });

  it('comodín hoy y mañana: se queda un caso para mañana y entrega otro; INC9 (de mañana) no hace falta incluirlo', async () => {
    const avisosAntes = await n(`select count(*)::int n from notificaciones where tecnico_id = '${ANA}'`);
    const t = await borrador(ANA, [['INC1', ANA], ['INC2', MARTA]]);
    await como(U_ANA, 'ana@noc.test');
    expect(await n('select enviar_traspaso($1) n', [t])).toBe(2);
    await como(null);

    // INC1 sigue siendo de Ana, ahora para su turno de mañana (llegó por traspaso)
    expect(await uno(`select tecnico_actual_id t, fecha_responsable::text f, origen_responsable o from casos_abiertos where codigo = 'INC1'`))
      .toEqual({ t: ANA, f: MANANA, o: 'traspaso' });
    expect(await n(`select count(*)::int n from caso_responsables where caso_id = $1`, [await idDe('INC1')])).toBe(2);
    expect(await n(`select count(*)::int n from caso_responsables where caso_id = $1 and hasta is null`, [await idDe('INC1')])).toBe(1);
    expect(await uno(`select fecha_destino::text f from traspaso_items where caso_id = $1`, [await idDe('INC1')])).toEqual({ f: MANANA });
    // A ella misma no se le avisa
    expect(await n(`select count(*)::int n from notificaciones where tecnico_id = '${ANA}'`)).toBe(avisosAntes);
    expect(await uno(`select detalle from bitacora where accion = 'caso_traspasado' and codigo = 'INC1'`))
      .toEqual({ detalle: `Se queda con Ana para su turno del ${MANANA.slice(8, 10)}/${MANANA.slice(5, 7)}` });
    // INC2 pasó a Marta para mañana, como cualquier traspaso
    expect(await uno(`select tecnico_actual_id t, fecha_responsable::text f from casos_abiertos where codigo = 'INC2'`))
      .toEqual({ t: MARTA, f: MANANA });
  });

  it('no puede quedarse un caso para el mismo día', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, descripcion, tecnico_actual_id) values ('INC7','Siete','${LUIS}')`);
    await como(null);
    await db.exec(`delete from traspasos where de_tecnico_id = '${LUIS}'`);
    const t = await borrador(LUIS, [['INC7', LUIS]]); // B hoy, sin jornada mañana
    await como(U_LUIS, 'luis@noc.test');
    await expect(db.query('select enviar_traspaso($1)', [t])).rejects.toThrow(/solo puede quedarse contigo/);
    await como(null);
  });
});
