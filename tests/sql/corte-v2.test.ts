// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';

async function baseConModeloAnterior() {
  const db = await crearBaseSupabase();
  await db.exec(MIGRACIONES.esquema());
  await db.exec(MIGRACIONES.v3());
  await db.exec(`
    insert into tecnicos (id, nombre, turno, almuerzo_inicio, almuerzo_fin) values
      ('${ANA}','Ana','turnoA','12:00','12:30'), ('${LUIS}','Luis','turnoB',null,null);
    insert into incidentes (codigo, nota, tecnico_id) values ('INC1','uno','${ANA}'), ('INC2',null,'${ANA}');
  `);
  return db;
}

describe('corte al modelo v2 (migración 05)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;
  const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;

  beforeAll(async () => {
    db = await baseConModeloAnterior();
    await db.exec(MIGRACIONES.v4());
    // La app anterior siguió en uso después de la 04 (pasó en producción)
    await db.exec(`
      insert into incidentes (codigo, nota, tecnico_id) values ('INC3','nuevo','${LUIS}');
      update incidentes set tecnico_id = '${LUIS}', nota = 'movido' where codigo = 'INC1';
      delete from incidentes where codigo = 'INC2';
    `);
    await db.exec(`truncate bitacora`);
    await db.exec(MIGRACIONES.corte());
    D = (await db.query<{ d: string }>('select fecha_operativa()::text d')).rows[0]!.d;
    como = actuarComo(db);
    await db.exec(`
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_ANA}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}','Ana','tecnico','${ANA}');
    `);
  });

  it('recoge lo que la app anterior cambió después de la 04, sin notificar ni ensuciar la bitácora', async () => {
    const casos = await db.query<{ codigo: string; estado: string; tecnico_actual_id: string; nota: string | null }>(
      'select codigo, estado, tecnico_actual_id, nota from casos order by codigo'
    );
    expect(casos.rows).toEqual([
      { codigo: 'INC1', estado: 'en_curso', tecnico_actual_id: LUIS, nota: 'movido' },
      { codigo: 'INC2', estado: 'cerrado', tecnico_actual_id: ANA, nota: null },
      { codigo: 'INC3', estado: 'en_curso', tecnico_actual_id: LUIS, nota: 'nuevo' }
    ]);
    expect(await n('select count(*)::int n from notificaciones')).toBe(0);
    expect(await n('select count(*)::int n from bitacora')).toBe(0);
  });

  it('elimina el modelo anterior y se puede ejecutar dos veces', async () => {
    expect((await db.query(`select to_regclass('public.incidentes') r`)).rows[0]).toEqual({ r: null });
    const columnas = await db.query<{ c: string }>(
      `select column_name c from information_schema.columns where table_name = 'tecnicos' order by ordinal_position`
    );
    expect(columnas.rows.map((r) => r.c)).toEqual(['id', 'nombre', 'created_at', 'activo']);
    await db.exec(MIGRACIONES.corte());
    expect(await n('select count(*)::int n from casos')).toBe(3);
  });

  it('el tablero lee los casos abiertos con el día operativo de su responsable', async () => {
    await como(U_ANA, 'ana@noc.test');
    const filas = await db.query<{ codigo: string; fecha_responsable: string }>(
      'select codigo, fecha_responsable::text fecha_responsable from casos_abiertos order by codigo'
    );
    expect(filas.rows).toEqual([
      { codigo: 'INC1', fecha_responsable: D },
      { codigo: 'INC3', fecha_responsable: D }
    ]);
    await db.exec('reset role; set role anon');
    await expect(db.query('select * from casos_abiertos')).rejects.toThrow(/permission denied/);
    await como(null);
  });

  it('solo el dispatch modifica técnicos; el nombre no se repite y desactivar queda en la bitácora', async () => {
    await como(U_ANA, 'ana@noc.test');
    await expect(db.exec(`insert into tecnicos (nombre) values ('Pedro')`)).rejects.toThrow(/row-level security/);

    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into tecnicos (nombre) values ('Pedro')`);
    await expect(db.exec(`insert into tecnicos (nombre) values (' pedro ')`)).rejects.toThrow(/tecnicos_nombre_unico/);
    await db.exec(`update tecnicos set activo = false where nombre = 'Pedro'`);
    await como(null);

    const acciones = await db.query<{ accion: string; usuario_email: string }>(
      `select accion, usuario_email from bitacora where tecnico = 'Pedro' order by created_at, id`
    );
    expect(acciones.rows).toEqual([
      { accion: 'tecnico_agregado', usuario_email: 'dispatch@noc.test' },
      { accion: 'tecnico_desactivado', usuario_email: 'dispatch@noc.test' }
    ]);
  });

  it('la bitácora vuelve a registrar fuera de la migración', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`update casos set tecnico_actual_id = '${ANA}' where codigo = 'INC3'`);
    await como(null);
    expect(await n(`select count(*)::int n from bitacora where accion = 'caso_reasignado' and codigo = 'INC3'`)).toBe(1);
    expect(await n(`select count(*)::int n from notificaciones where tecnico_id = '${ANA}'`)).toBe(1);
  });
});

describe('corte con técnicos de nombre repetido', () => {
  it('se detiene y dice cuáles renombrar, sin cambiar nada', async () => {
    const db = await crearBaseSupabase();
    await db.exec(MIGRACIONES.esquema());
    await db.exec(MIGRACIONES.v3());
    await db.exec(`insert into tecnicos (nombre, turno) values ('Ana','turnoA'), ('ana','turnoB')`);
    await db.exec(MIGRACIONES.v4());

    await expect(db.exec(MIGRACIONES.corte())).rejects.toThrow(/mismo nombre/);
    await db.exec('rollback');
    expect((await db.query(`select to_regclass('public.incidentes') r`)).rows[0]).not.toEqual({ r: null });
  });
});

describe('datos de demostración (modelo v2)', () => {
  it('cargan la semana planificada y los casos sin tocar los perfiles', async () => {
    const db = await crearBaseSupabase();
    await db.exec(MIGRACIONES.esquema());
    await db.exec(MIGRACIONES.v3());
    await db.exec(MIGRACIONES.v4());
    await db.exec(MIGRACIONES.corte());
    await db.exec(`
      create table public.entorno_dev (id int);
      insert into auth.users (id) values ('${U_DISPATCH}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch');
    `);
    await db.exec(MIGRACIONES.demo());
    await db.exec(MIGRACIONES.demo()); // se puede repetir

    const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;
    expect(await n('select count(*)::int n from tecnicos')).toBe(6);
    expect(await n('select count(*)::int n from jornadas')).toBe(42);
    expect(await n('select count(*)::int n from jornadas where fecha_operativa = fecha_operativa()')).toBe(6);
    expect(await n('select count(*)::int n from casos_abiertos')).toBe(6);
    expect(await n('select count(*)::int n from perfiles')).toBe(1);
    expect(await n('select count(*)::int n from historial_snapshots')).toBe(1);
  });
});
