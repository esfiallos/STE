// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const leer = (archivo: string) => readFileSync(resolve(process.cwd(), 'sql', archivo), 'utf8');
/** El bloque de pg_cron solo existe en Supabase: se prueba todo lo anterior. */
const migracionSinCron = leer('02_migracion_v3.sql').split('-- 5. Programar')[0]!.replace(/-- =+\s*$/, '');

/** El reloj del PostgreSQL de prueba tiene precisión de milisegundos: una pausa evita horas idénticas y orden ambiguo. */
const pausa = () => new Promise((resolver) => setTimeout(resolver, 5));

const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';

/** PostgreSQL de prueba con lo mínimo que Supabase aporta: roles, auth.uid()/jwt() y la publicación. */
async function crearBaseConSupabaseSimulado() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create publication supabase_realtime;
  `);
  return db;
}

describe('esquema y migración v3', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await crearBaseConSupabaseSimulado();
    await db.exec(leer('01_schema_inicial.sql'));
    await db.exec(`
      insert into tecnicos (id, nombre, turno, almuerzo_inicio, almuerzo_fin) values
        ('${ANA}','Ana','turnoA','12:00','12:30'), ('${LUIS}','Luis','turnoB',null,null);
      insert into incidentes (codigo, nota, tecnico_id) values ('inc-old','previo','${ANA}');
    `);
    await db.exec(migracionSinCron);
  });

  it('conserva los datos existentes y se puede ejecutar dos veces', async () => {
    expect((await db.query<{ n: number }>('select count(*)::int n from incidentes')).rows[0]!.n).toBe(1);
    await db.exec(migracionSinCron);
  });

  it('el comodín exige un horario válido y el turno debe existir', async () => {
    await db.exec(`insert into tecnicos (nombre, turno, horario_inicio, horario_fin) values ('Marta','comodin','07:00','17:00')`);
    await expect(db.exec(`insert into tecnicos (nombre, turno) values ('Sin horario','comodin')`)).rejects.toThrow(/comodin_requiere_horario/);
    await expect(db.exec(`insert into tecnicos (nombre, turno) values ('X','turnoZ')`)).rejects.toThrow(/tecnicos_turno_check/);
  });

  it('normaliza el código y un INC no puede repetirse', async () => {
    await db.exec(`insert into incidentes (codigo, tecnico_id) values (' inc900 ','${ANA}')`);
    expect((await db.query<{ codigo: string }>(`select codigo from incidentes where codigo = 'INC900'`)).rows).toHaveLength(1);
    await expect(db.exec(`insert into incidentes (codigo, tecnico_id) values ('INC900','${LUIS}')`)).rejects.toThrow(/incidentes_codigo_unico/);
    await db.exec(`delete from incidentes where codigo = 'INC900'`);
  });

  it('la bitácora la escriben los triggers con el usuario de la sesión', async () => {
    await db.exec(`select set_config('request.jwt.claims','{"email":"emerson@tigo.com.hn"}', false)`);
    await db.exec(`insert into incidentes (codigo, nota, tecnico_id) values ('INC777','Fibra','${LUIS}')`);
    await pausa();
    await db.exec(`update incidentes set tecnico_id = '${ANA}' where codigo = 'INC777'`);
    await pausa();
    await db.exec(`update tecnicos set almuerzo_inicio='13:00', almuerzo_fin='13:30' where nombre='Luis'`);
    await pausa();
    await db.exec(`delete from incidentes where codigo = 'INC777'`);

    const { rows } = await db.query<{ accion: string; codigo: string | null; tecnico: string | null; detalle: string | null; usuario_email: string }>(
      `select accion, codigo, tecnico, detalle, usuario_email from bitacora where codigo = 'INC777' or detalle = '13:00 - 13:30' order by created_at, id`
    );

    expect(rows.map((r) => r.accion)).toEqual(['incidente_asignado', 'incidente_reasignado', 'almuerzo_actualizado', 'incidente_eliminado']);
    expect(rows.every((r) => r.usuario_email === 'emerson@tigo.com.hn')).toBe(true);
    expect(rows[0]).toMatchObject({ tecnico: 'Luis', detalle: 'Fibra' });
    expect(rows[1]!.detalle).toBe('De Luis a Ana');
    expect(rows[3]).toMatchObject({ tecnico: 'Ana' });
  });

  it('al borrar un técnico se borran sus casos y todo queda registrado', async () => {
    await db.exec(`delete from tecnicos where nombre = 'Ana'`);
    const { rows } = await db.query<{ accion: string; detalle: string | null }>(`select accion, detalle from bitacora order by created_at desc, id desc limit 6`);

    expect(rows.some((r) => r.accion === 'tecnico_eliminado')).toBe(true);
    expect(rows.some((r) => r.accion === 'incidente_eliminado' && r.detalle === 'Se eliminó junto con su técnico')).toBe(true);
  });

  it('genera el snapshot del día (uno por fecha, regenerarlo lo reemplaza) con la forma que lee la app', async () => {
    await db.exec(`insert into incidentes (codigo, nota, tecnico_id) values ('INC1234','Router caído','${LUIS}'), ('INC1235',null,'${LUIS}')`);
    await db.exec(`select generar_snapshot_diario('2026-11-09')`);
    await db.exec(`select generar_snapshot_diario('2026-11-09')`);

    const filas = await db.query<{ f: string; n: number }>(`select fecha::text f, jsonb_array_length(datos_panel) n from historial_snapshots`);
    expect(filas.rows).toEqual([{ f: '2026-11-09', n: 2 }]); // Luis y la comodín (Ana ya fue eliminada)

    const { rows } = await db.query<{ t: { turno: string; incidentes: { codigo: string; tecnicoId: string }[]; horarioInicio: string | null } }>(
      `select t from historial_snapshots, jsonb_array_elements(datos_panel) t where t->>'nombre' = 'Luis'`
    );
    expect(rows[0]!.t.turno).toBe('turnoB');
    expect(rows[0]!.t.incidentes.map((i) => i.codigo)).toEqual(['INC1234', 'INC1235']);
    expect(rows[0]!.t.incidentes[0]!.tecnicoId).toBe(LUIS);
    expect(rows[0]!.t).toHaveProperty('horarioInicio');
  });

  it('busca en el historial y en la bitácora', async () => {
    const h = (termino: string) => db.query<{ tecnico: string; fecha: Date }>(`select * from buscar_en_historial('${termino}')`);
    expect((await h('inc1234')).rows).toMatchObject([{ tecnico: 'Luis' }]);
    expect((await h('router')).rows).toHaveLength(1);
    expect((await h('luis')).rows).toHaveLength(2);
    expect((await h('  ')).rows).toHaveLength(0);
    expect((await h('%')).rows).toHaveLength(0); // el % no es comodín

    expect((await db.query(`select * from buscar_en_bitacora('INC777')`)).rows).toHaveLength(3);
    expect((await db.query(`select * from buscar_en_bitacora('emerson')`)).rows.length).toBeGreaterThan(0);
  });

  it('nadie puede generar snapshots ni escribir la bitácora desde la app', async () => {
    const permisos = await db.query<{ a: boolean; b: boolean }>(`
      select has_function_privilege('authenticated', 'public.generar_snapshot_diario(date)', 'execute') a,
             has_function_privilege('authenticated', 'public.registrar_bitacora(text,text,text,text)', 'execute') b`);
    expect(permisos.rows[0]).toEqual({ a: false, b: false });
  });
});

describe('datos de demostración de desarrollo', () => {
  it('se niegan a ejecutarse en una base que no es de desarrollo', async () => {
    const db = await crearBaseConSupabaseSimulado();
    await db.exec(leer('01_schema_inicial.sql'));
    await db.exec(migracionSinCron);
    await db.exec(`insert into tecnicos (nombre, turno) values ('Real','turnoA')`);

    await expect(db.exec(leer('03_datos_demo_dev.sql'))).rejects.toThrow(/NO es la base de desarrollo/);
    expect((await db.query<{ n: number }>('select count(*)::int n from tecnicos')).rows[0]!.n).toBe(1);
  });

  it('en la base de desarrollo cargan técnicos, casos y un snapshot de ayer', async () => {
    const db = await crearBaseConSupabaseSimulado();
    await db.exec(leer('01_schema_inicial.sql'));
    await db.exec(migracionSinCron);
    await db.exec('create table public.entorno_dev (id int)');
    await db.exec(leer('03_datos_demo_dev.sql'));

    const n = async (tabla: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${tabla}`)).rows[0]!.n;
    expect(await n('tecnicos')).toBe(6);
    expect(await n('incidentes')).toBe(6);
    expect(await n('historial_snapshots')).toBe(1);
    expect((await db.query(`select 1 from tecnicos where turno = 'comodin'`)).rows).toHaveLength(1);
  });
});
