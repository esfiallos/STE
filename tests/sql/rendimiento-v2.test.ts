// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const U_INTRUSO = 'e0000000-0000-0000-0000-000000000009';
const LUIS = '22222222-2222-2222-2222-222222222222';
const PEDRO = '44444444-4444-4444-4444-444444444444';

/** Llamadas a funciones de rol sin envolver en (select …) dentro de una expresión de política. */
const SIN_ENVOLVER = String.raw`(?<!SELECT )\m(es_dispatch|es_coordinador|tiene_perfil|mi_tecnico_id|mi_rol|fecha_operativa)\(\)|(?<!SELECT )auth\.uid\(\)`;

describe('rendimiento (migración 19)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const buscar = async (termino: string, limite = 50) =>
    (await db.query<{ codigo: string }>('select codigo from buscar_casos($1, $2)', [termino, limite])).rows.map((r) => r.codigo);

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const m of ['esquema', 'v3', 'v4', 'corte', 'seguimiento', 'traspasos', 'coordinador', 'ronda', 'planificacion',
                     'tableroDelDia', 'seguimientoDescripcion', 'filtros', 'turnoC', 'traspasoPropio', 'proteccion',
                     'entregaSupervision', 'planificacionConAviso'] as const) {
      await db.exec(MIGRACIONES[m]());
    }
    await db.exec(MIGRACIONES.rendimiento());
    await db.exec(MIGRACIONES.rendimiento()); // se puede ejecutar dos veces
    como = actuarComo(db);

    await db.exec(`
      insert into tecnicos (id, nombre) values ('${LUIS}','Luis Mora'), ('${PEDRO}','Pedro Ríos');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_COORD}'), ('${U_LUIS}'), ('${U_INTRUSO}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch'), ('${U_COORD}','Coord','coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_LUIS}','Luis','tecnico','${LUIS}');
    `);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, cliente, area, descripcion, tecnico_actual_id) values
      ('INC100', 'Banco Atlántida', 'CPE', 'Enlace caído en la sucursal', '${PEDRO}'),
      ('SCTASK200', 'Hospital Escuela', 'TX', 'Cambio de equipo 50%_listo', '${LUIS}'),
      ('INC300', 'Tigo Money', 'CORE IP', 'Sin novedad', '${PEDRO}')`);
    // INC100 pasa de Pedro a Luis: Pedro queda solo en el historial
    await db.exec(`update casos set tecnico_actual_id = '${LUIS}' where codigo = 'INC100'`);
    await como(null);
    await db.exec(`update casos set etiqueta = 'esperando proveedor' where codigo = 'INC300';
                   update casos set estado = 'cerrado' where codigo = 'SCTASK200';`);
  });

  it('ninguna política llama a una función de rol fila por fila, y no se envuelven dos veces', async () => {
    await como(null);
    const malas = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where schemaname = 'public'
       and (coalesce(qual, '') ~ $1 or coalesce(with_check, '') ~ $1 or coalesce(qual, '') ~* 'select \\( select')`,
      [SIN_ENVOLVER]
    );
    expect(malas.rows).toEqual([]);
    const envueltas = await uno<{ n: number }>(`select count(*)::int n from pg_policies where schemaname = 'public' and qual ~* 'select tiene_perfil'`);
    expect(envueltas.n).toBe(4); // casos, caso_responsables, jornadas, tecnicos
  });

  it('los permisos siguen igual: sin perfil no ve nada y el técnico solo edita lo suyo', async () => {
    await como(U_INTRUSO, 'intruso@noc.test');
    expect((await uno<{ n: number }>('select count(*)::int n from casos')).n).toBe(0);
    expect((await uno<{ n: number }>('select count(*)::int n from caso_responsables')).n).toBe(0);
    await como(U_LUIS, 'luis@noc.test');
    expect((await uno<{ n: number }>('select count(*)::int n from casos')).n).toBe(3);
    const r = await db.query(`update casos set etiqueta = 'mía' where codigo = 'INC300' returning id`);
    expect(r.rows).toHaveLength(0); // INC300 es de Pedro
    await como(U_COORD, 'coord@noc.test');
    expect((await uno<{ n: number }>('select count(*)::int n from perfiles')).n).toBe(3);
  });

  it('buscar_casos encuentra lo mismo que antes', async () => {
    await como(U_COORD, 'coord@noc.test');
    expect(await buscar('inc1')).toEqual(['INC100']);              // código, sin distinguir mayúsculas
    expect(await buscar('hospital')).toEqual(['SCTASK200']);       // empresa
    expect(await buscar('sucursal')).toEqual(['INC100']);          // descripción
    expect(await buscar('core ip')).toEqual(['INC300']);           // área
    expect(await buscar('proveedor')).toEqual(['INC300']);         // etiqueta
    expect((await buscar('pedro')).sort()).toEqual(['INC100', 'INC300']); // técnico actual (INC300) e historial (INC100)
    expect(await buscar('luis')).toEqual(['INC100', 'SCTASK200']); // los cerrados al final
    expect(await buscar('50%_')).toEqual(['SCTASK200']);           // % y _ son literales
    expect(await buscar('5%')).toEqual([]);
    expect(await buscar('   ')).toEqual([]);
    expect(await buscar('luis', 1)).toEqual(['INC100']);
  });

  it('sin perfil la búsqueda no devuelve nada, ni siquiera ids', async () => {
    await como(U_INTRUSO, 'intruso@noc.test');
    expect(await buscar('inc')).toEqual([]);
    expect((await uno<{ n: number }>(`select count(*)::int n from casos_que_coinciden('inc')`)).n).toBe(0);
    await como(null, '');
    await db.exec('set role anon');
    await expect(db.query(`select * from casos_que_coinciden('inc')`)).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });

  it('la búsqueda usa el índice de trigramas', async () => {
    await como(null);
    await db.exec('set enable_seqscan = off');
    const plan = await db.query<{ 'QUERY PLAN': string }>(
      `explain select id from casos where texto_de_busqueda_caso(codigo, cliente, area, nota, descripcion, etiqueta, ultima_actualizacion) ilike '%sucursal%'`
    );
    await db.exec('reset enable_seqscan');
    expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('casos_busqueda_trgm');
  });
});
