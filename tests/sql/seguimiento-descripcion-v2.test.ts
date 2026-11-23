// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const U_MARTA = 'a0000000-0000-0000-0000-000000000003';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';
const MARTA = '33333333-3333-3333-3333-333333333333';

describe('seguimiento: descripción y última actualización (migración 12)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;
  let MANANA: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const idDe = async (codigo: string) => (await uno<{ id: string }>('select id from casos where codigo = $1', [codigo])).id;
  const caso = (codigo: string) =>
    uno<{ descripcion: string | null; en: string | null; por: string | null; actividad: string | null }>(
      `select descripcion, ultima_actualizacion_en::text en, ultima_actualizacion_por por, actividad_tecnico_en::text actividad from casos where codigo = $1`,
      [codigo]
    );

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const paso of [MIGRACIONES.esquema, MIGRACIONES.v3, MIGRACIONES.v4, MIGRACIONES.corte, MIGRACIONES.seguimiento,
      MIGRACIONES.traspasos, MIGRACIONES.coordinador, MIGRACIONES.ronda, MIGRACIONES.planificacion, MIGRACIONES.tableroDelDia]) {
      await db.exec(paso());
    }
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    MANANA = (await uno<{ d: string }>(`select ('${D}'::date + 1)::text d`)).d;

    // Ana trabaja el turno B: entrega a Luis (C, hoy) y a Marta (A, mañana)
    await db.exec(`
      insert into tecnicos (id, nombre) values ('${ANA}','Ana'), ('${LUIS}','Luis'), ('${MARTA}','Marta');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values
        ('${D}','${ANA}','turnoB'), ('${D}','${LUIS}','turnoC'), ('${MANANA}','${MARTA}','turnoA');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_ANA}'), ('${U_LUIS}'), ('${U_MARTA}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch');
      insert into perfiles (id, nombre, rol, tecnico_id) values
        ('${U_ANA}','Ana','tecnico','${ANA}'), ('${U_LUIS}','Luis','tecnico','${LUIS}'), ('${U_MARTA}','Marta','tecnico','${MARTA}');
    `);

    // Antes de la 12: un caso con texto de "última actualización" y sin descripción
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, tecnico_actual_id) values ('INC-VIEJO','${ANA}'), ('INC1','${ANA}'), ('INC2','${ANA}')`);
    await como(U_ANA, 'ana@noc.test');
    await db.exec(`update casos set ultima_actualizacion = 'Esperando al proveedor' where codigo = 'INC-VIEJO'`);
    await como(null);

    await db.exec(MIGRACIONES.seguimientoDescripcion());
    await db.exec(MIGRACIONES.seguimientoDescripcion()); // se puede ejecutar dos veces
  });

  it('el texto viejo de última actualización pasó a la descripción', async () => {
    const viejo = await caso('INC-VIEJO');
    expect(viejo.descripcion).toBe('Esperando al proveedor');
    expect(viejo.en).not.toBeNull();
    expect((await uno<{ n: number }>(`select count(*)::int n from bitacora where accion = 'migracion_descripcion'`)).n).toBe(1);
  });

  it('el técnico escribe la descripción y cualquier edición suya marca la última actualización', async () => {
    expect((await caso('INC1')).en).toBeNull();
    await como(U_ANA, 'ana@noc.test');
    await db.exec(`update casos set descripcion = '  Se reinició el CPE  ' where codigo = 'INC1'`);
    await expect(db.exec(`update casos set codigo = 'X' where codigo = 'INC1'`)).rejects.toThrow(/Solo el dispatch/);
    await como(null);
    const inc1 = await caso('INC1');
    expect(inc1.descripcion).toBe('Se reinició el CPE');
    expect(inc1.por).toBe('ana@noc.test');
    expect(inc1.en).not.toBeNull();
    expect(inc1.actividad).toBe(inc1.en);
    expect((await uno<{ detalle: string }>(`select detalle from bitacora where accion = 'descripcion_cambiada' and codigo = 'INC1'`)).detalle).toBe('Se reinició el CPE');

    // Una edición del dispatch no es una actualización del técnico
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`update casos set cliente = 'ACME' where codigo = 'INC1'`);
    await como(null);
    expect((await caso('INC1')).en).toBe(inc1.en);
  });

  it('"Actualizado" marca la fecha sin cambiar nada; solo el responsable y con el caso abierto', async () => {
    const antes = await caso('INC2');
    expect(antes.en).toBeNull();
    await como(U_ANA, 'ana@noc.test');
    const { en } = await uno<{ en: string }>('select marcar_actualizado($1)::text en', [await idDe('INC2')]);
    await como(U_LUIS, 'luis@noc.test');
    await expect(db.query('select marcar_actualizado($1)', [await idDe('INC2')])).rejects.toThrow(/Solo el responsable/);
    await como(null);
    const despues = await caso('INC2');
    expect(despues.en).toBe(en);
    expect(despues.actividad).toBe(en);
    expect(despues.por).toBe('ana@noc.test');
    expect(despues.descripcion).toBeNull();
  });

  it('cerrar turno exige descripción, la guarda en el caso y los casos llegan al seguimiento de cada receptor', async () => {
    await como(U_ANA, 'ana@noc.test');
    const { id: traspaso } = await uno<{ id: string }>(`insert into traspasos (de_tecnico_id, fecha_operativa) values ('${ANA}', '${D}') returning id`);
    await db.query(
      `insert into traspaso_items (traspaso_id, caso_id, para_tecnico_id, estado, descripcion) values
        ($1, $2, '${LUIS}', 'en_curso', null),
        ($1, $3, '${MARTA}', 'pausado', null),
        ($1, $4, null, 'cerrado', null)`,
      [traspaso, await idDe('INC1'), await idDe('INC2'), await idDe('INC-VIEJO')]
    );
    // INC2 no tiene descripción ni en el ítem ni en el caso
    await expect(db.query('select enviar_traspaso($1)', [traspaso])).rejects.toThrow(/INC2 necesita su descripción/);

    await db.query(`update traspaso_items set descripcion = 'Pendiente visita técnica' where caso_id = $1`, [await idDe('INC2')]);
    const { movidos } = await uno<{ movidos: number }>('select enviar_traspaso($1) movidos', [traspaso]);
    expect(movidos).toBe(2);
    await como(null);

    // INC1 viajó con la descripción que ya tenía el caso; INC2 con la del ítem
    expect((await caso('INC1')).descripcion).toBe('Se reinició el CPE');
    const inc2 = await caso('INC2');
    expect(inc2.descripcion).toBe('Pendiente visita técnica');
    const items = await db.query<{ codigo: string; descripcion: string; con_fecha: boolean }>(
      `select c.codigo, i.descripcion, i.actualizado_en is not null con_fecha from traspaso_items i join casos c on c.id = i.caso_id order by c.codigo`
    );
    expect(items.rows).toEqual([
      { codigo: 'INC-VIEJO', descripcion: 'Esperando al proveedor', con_fecha: true },
      { codigo: 'INC1', descripcion: 'Se reinició el CPE', con_fecha: true },
      { codigo: 'INC2', descripcion: 'Pendiente visita técnica', con_fecha: true }
    ]);

    // Cada receptor lo ve en sus casos abiertos (base de Mi seguimiento), con su día operativo
    await como(U_LUIS, 'luis@noc.test');
    const deLuis = await db.query<{ codigo: string; fecha_responsable: string; origen_responsable: string }>(
      `select codigo, fecha_responsable::text, origen_responsable from casos_abiertos where tecnico_actual_id = '${LUIS}'`
    );
    expect(deLuis.rows).toEqual([{ codigo: 'INC1', fecha_responsable: D, origen_responsable: 'traspaso' }]);
    await como(U_MARTA, 'marta@noc.test');
    const deMarta = await db.query<{ codigo: string; fecha_responsable: string; estado: string; descripcion: string }>(
      `select codigo, fecha_responsable::text, estado, descripcion from casos_abiertos where tecnico_actual_id = '${MARTA}'`
    );
    expect(deMarta.rows).toEqual([{ codigo: 'INC2', fecha_responsable: MANANA, estado: 'pausado', descripcion: 'Pendiente visita técnica' }]);
    await como(null);
  });
});
