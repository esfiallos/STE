// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';

describe('coordinador (migración 08)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  /** Momento (Honduras) del día operativo D a la hora indicada. */
  const a = (hora: string, dias = 0) => `(('${D}'::date + ${dias}) + time '${hora}')::timestamp at time zone 'America/Tegucigalpa'`;
  const alertas = (ahora: string) => uno<{ n: number }>(`select generar_alertas_coordinacion(${ahora}) n`).then((r) => r.n);
  /** Escribe como administrador sin disparar triggers (para fijar horas en la prueba). */
  const sinTriggers = async (sql: string) => {
    await db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = origin;`);
  };

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const paso of [MIGRACIONES.esquema, MIGRACIONES.v3, MIGRACIONES.v4, MIGRACIONES.corte, MIGRACIONES.seguimiento, MIGRACIONES.traspasos]) {
      await db.exec(paso());
    }
    await db.exec(MIGRACIONES.coordinador());
    await db.exec(MIGRACIONES.coordinador()); // se puede ejecutar dos veces
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;

    await db.exec(`
      insert into tecnicos (id, nombre) values ('${ANA}','Ana Pérez'), ('${LUIS}','Luis Mora');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${D}','${ANA}','turnoA'), ('${D}','${LUIS}','turnoB');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_COORD}'), ('${U_ANA}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch'), ('${U_COORD}','Coordinación','coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}','Ana','tecnico','${ANA}');
    `);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`
      insert into casos (codigo, nota, tecnico_actual_id) values ('INC100','ACME · enlace 4410','${ANA}'), ('SCTASK200','100% caído','${LUIS}');
      insert into casos (codigo, nota, tecnico_actual_id, estado) values ('INC300','Viejo','${LUIS}','cerrado');
    `);
    await como(null);
    await db.exec(`update casos set cliente = 'ACME', area = 'CORE IP' where codigo = 'INC100'`);
  });

  it('el coordinador es un rol sin técnico', async () => {
    await expect(db.exec(`insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000002');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('c0000000-0000-0000-0000-000000000002','X','coordinador','${LUIS}')`)).rejects.toThrow(/dispatch_sin_tecnico/);
    await como(U_COORD, 'coord@noc.test');
    expect((await uno<{ es: boolean }>('select es_coordinador() es')).es).toBe(true);
    await como(U_DISPATCH);
    expect((await uno<{ es: boolean }>('select es_coordinador() es')).es).toBe(false);
    await como(null);
  });

  it('el coordinador lee los traspasos de todos pero no edita casos', async () => {
    await como(U_ANA, 'ana@noc.test');
    const { id } = await uno<{ id: string }>(`insert into traspasos (de_tecnico_id, fecha_operativa) values ('${ANA}','${D}') returning id`);
    await db.exec(`insert into traspaso_items (traspaso_id, caso_id, para_tecnico_id) select '${id}', id, '${LUIS}' from casos where codigo = 'INC100'`);

    await como(U_COORD, 'coord@noc.test');
    expect((await db.query('select 1 from traspasos')).rows).toHaveLength(1);
    expect((await db.query('select 1 from traspaso_items')).rows).toHaveLength(1);
    await db.exec(`update casos set estado = 'cerrado' where codigo = 'INC100'`); // RLS: no hace nada
    await expect(db.exec(`insert into casos (codigo) values ('INC999')`)).rejects.toThrow(/row-level security/);
    await como(null);
    expect((await uno<{ estado: string }>(`select estado from casos where codigo = 'INC100'`)).estado).toBe('en_curso');
  });

  it('busca en todos los casos: código, empresa, nota y técnico; los cerrados al final', async () => {
    await como(U_COORD, 'coord@noc.test');
    const buscar = async (termino: string) =>
      (await db.query<{ codigo: string; tecnico_actual: string | null }>('select codigo, tecnico_actual from buscar_casos($1)', [termino])).rows;

    expect(await buscar('inc1')).toEqual([{ codigo: 'INC100', tecnico_actual: 'Ana Pérez' }]);
    expect((await buscar('acme')).map((r) => r.codigo)).toEqual(['INC100']);
    expect((await buscar('luis')).map((r) => r.codigo)).toEqual(['SCTASK200', 'INC300']);
    expect((await buscar('100%')).map((r) => r.codigo)).toEqual(['SCTASK200']); // el % se busca literal
    expect(await buscar('   ')).toEqual([]);
    await como(null);
  });

  it('estadísticas del día: casos que tuvieron responsable hoy, por estado', async () => {
    await como(U_COORD, 'coord@noc.test');
    const filas = await db.query<{ estado: string; total: number }>('select estado, total from estadisticas_del_dia() order by estado');
    expect(filas.rows).toEqual([{ estado: 'en_curso', total: 2 }]); // INC300 se creó cerrado: nunca tuvo responsable
    await como(null);
  });

  describe('alertas por falta de actualización', () => {
    beforeAll(async () => {
      // Ana recibió INC100 a las 06:30 de hoy; Luis (turno B) recibió SCTASK200 a las 13:00
      await sinTriggers(`
        update caso_responsables set desde = ${a('06:30')} where caso_id = (select id from casos where codigo = 'INC100');
        update caso_responsables set desde = ${a('13:00')} where caso_id = (select id from casos where codigo = 'SCTASK200')`);
    });

    it('avisa a las 2, 4 y 6 horas, solo mientras el responsable está en su turno', async () => {
      expect(await alertas(a('08:29'))).toBe(0);
      expect(await alertas(a('08:30'))).toBe(1);
      expect(await alertas(a('09:00'))).toBe(0);
      expect(await alertas(a('10:30'))).toBe(1);
      expect(await alertas(a('12:30'))).toBe(1);
      // A las 16:00 Ana ya salió; Luis entró a las 14:00 (las horas antes de su turno no cuentan)
      expect(await alertas(a('16:00'))).toBe(1);
      const niveles = await db.query<{ detalle: string; nivel: number; tecnico_nombre: string }>(
        `select detalle, nivel, tecnico_nombre from alertas_coordinacion order by creado_en`
      );
      expect(niveles.rows).toEqual([
        { detalle: 'INC100', nivel: 2, tecnico_nombre: 'Ana Pérez' },
        { detalle: 'INC100', nivel: 4, tecnico_nombre: 'Ana Pérez' },
        { detalle: 'INC100', nivel: 6, tecnico_nombre: 'Ana Pérez' },
        { detalle: 'SCTASK200', nivel: 2, tecnico_nombre: 'Luis Mora' }
      ]);
    });

    it('una actualización del técnico reinicia el conteo y deja leídas las alertas anteriores', async () => {
      await sinTriggers(`update casos set actividad_tecnico_en = ${a('17:00')} where codigo = 'SCTASK200'`);
      expect(await alertas(a('18:59'))).toBe(0);
      expect((await uno<{ n: number }>(`select count(*)::int n from alertas_coordinacion where detalle = 'SCTASK200' and not leida`)).n).toBe(0);
      expect(await alertas(a('19:00'))).toBe(1);
    });

    it('al cerrar el caso sus alertas quedan leídas', async () => {
      await db.exec(`update casos set estado = 'cerrado' where codigo = 'SCTASK200'`);
      await alertas(a('19:05'));
      expect((await uno<{ n: number }>(`select count(*)::int n from alertas_coordinacion where detalle = 'SCTASK200' and not leida`)).n).toBe(0);
    });

    it('solo coordinación las ve y solo puede marcarlas leídas', async () => {
      await como(U_DISPATCH, 'dispatch@noc.test');
      expect((await db.query('select 1 from alertas_coordinacion')).rows).toHaveLength(0);
      await como(U_ANA, 'ana@noc.test');
      expect((await db.query('select 1 from alertas_coordinacion')).rows).toHaveLength(0);
      await expect(db.query('select generar_alertas_coordinacion()')).rejects.toThrow(/permission denied/);

      await como(U_COORD, 'coord@noc.test');
      expect((await db.query('select 1 from alertas_coordinacion where not leida')).rows).toHaveLength(3);
      await db.exec(`update alertas_coordinacion set leida = true where nivel = 2`);
      await expect(db.exec(`update alertas_coordinacion set nivel = 4`)).rejects.toThrow(/permission denied/);
      await expect(db.exec(`delete from alertas_coordinacion`)).rejects.toThrow(/permission denied/);
      expect((await db.query('select 1 from alertas_coordinacion where not leida')).rows).toHaveLength(2);
      await como(null);
    });
  });

  it('un recordatorio cuyo responsable no trabaja ese día también avisa a coordinación', async () => {
    await sinTriggers(`update casos set recordatorio_fecha = '${D}'::date + 1, recordatorio_texto = 'VM 10:00' where codigo = 'INC100'`);
    expect((await uno<{ n: number }>(`select generar_recordatorios(${a('06:00', 1)}) n`)).n).toBe(1);
    const alerta = await uno<{ tipo: string; detalle: string; nivel: number | null }>(
      `select tipo, detalle, nivel from alertas_coordinacion where tipo = 'recordatorio_sin_jornada'`
    );
    expect(alerta).toEqual({ tipo: 'recordatorio_sin_jornada', detalle: 'INC100: VM 10:00', nivel: null });
  });
});
