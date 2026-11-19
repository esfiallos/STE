// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DESTINOS_DE_TRASPASO, desfaseDeTraspaso } from '../../src/domain/handover';
import type { TurnoTecnico } from '../../src/types/noc';

const leer = (archivo: string) => readFileSync(resolve(process.cwd(), 'sql', archivo), 'utf8');
const migracionV3 = leer('02_migracion_v3.sql').split('-- 5. Programar')[0]!.replace(/-- =+\s*$/, '');
const migracionV4 = leer('04_v2_modelo_base.sql');
const pausa = () => new Promise((resolver) => setTimeout(resolver, 5));

// Usuarios (auth.users) y técnicos
const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';
const MARTA = '33333333-3333-3333-3333-333333333333';
const CARLOS = '44444444-4444-4444-4444-444444444444';
const CORREOS: Record<string, string> = {
  [U_DISPATCH]: 'dispatch@noc.test',
  [U_ANA]: 'ana@noc.test',
  [U_LUIS]: 'luis@noc.test'
};

/** PostgreSQL de prueba con lo que Supabase aporta: roles, auth.users, auth.uid()/jwt(), permisos por defecto y la publicación. */
async function crearBase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create publication supabase_realtime;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  return db;
}

describe('modelo v2 (migración 04)', () => {
  let db: PGlite;
  let D: string; // fecha operativa de hoy
  let D1: string; // día siguiente

  /** Actúa como un usuario de la app (rol authenticated + su JWT) o como administrador (null). */
  async function como(uid: string | null) {
    await db.exec('reset role');
    const claims = uid ? JSON.stringify({ sub: uid, email: CORREOS[uid] }) : '';
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid ?? '', claims]);
    if (uid) await db.exec('set role authenticated');
  }

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const caso = (codigo: string) =>
    uno<{ id: string; tecnico_actual_id: string | null; estado: string; ultima_actualizacion_por: string | null; etiqueta: string | null }>(
      'select * from casos where codigo = $1',
      [codigo]
    );

  beforeAll(async () => {
    db = await crearBase();
    await db.exec(leer('01_schema_inicial.sql'));
    await db.exec(migracionV3);
    await db.exec(`
      insert into tecnicos (id, nombre, turno, almuerzo_inicio, almuerzo_fin) values
        ('${ANA}','Ana','turnoA','12:00','12:30'), ('${LUIS}','Luis','turnoB',null,null);
      insert into tecnicos (id, nombre, turno, horario_inicio, horario_fin) values ('${MARTA}','Marta','comodin','09:00','19:00');
      insert into tecnicos (id, nombre, turno) values ('${CARLOS}','Carlos','turnoC');
      insert into incidentes (codigo, nota, tecnico_id) values ('inc-old','previo','${ANA}');
    `);
    await db.exec(migracionV4);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    D1 = (await uno<{ d: string }>('select (fecha_operativa() + 1)::text d')).d;

    await db.exec(`
      insert into auth.users (id, email) values ('${U_DISPATCH}','dispatch@noc.test'), ('${U_ANA}','ana@noc.test'), ('${U_LUIS}','luis@noc.test');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}','Ana','tecnico','${ANA}'), ('${U_LUIS}','Luis','tecnico','${LUIS}');
    `);
  });

  it('el día operativo empieza a las 06:00 de Honduras', async () => {
    const f = (utc: string) => uno<{ d: string }>(`select fecha_operativa($1::timestamptz)::text d`, [utc]);
    expect((await f('2026-11-18T11:59:00Z')).d).toBe('2026-11-17'); // 05:59 en Honduras
    expect((await f('2026-11-18T12:00:00Z')).d).toBe('2026-11-18'); // 06:00 en Honduras
  });

  it('la regla de traspaso de la base coincide con la del dominio', async () => {
    const turnos = Object.keys(DESTINOS_DE_TRASPASO) as TurnoTecnico[];
    for (const origen of turnos) {
      for (const destino of turnos) {
        const { d } = await uno<{ d: number | null }>('select desfase_traspaso($1, $2) d', [origen, destino]);
        expect(d, `${origen} → ${destino}`).toBe(desfaseDeTraspaso(origen, destino));
      }
    }
  });

  it('copia el turno de hoy y los incidentes, sin notificar, y se puede ejecutar dos veces', async () => {
    await db.exec(migracionV4);
    const jornadas = await db.query<{ nombre: string; turno: string }>(
      `select t.nombre, j.turno from jornadas j join tecnicos t on t.id = j.tecnico_id where j.fecha_operativa = $1 order by t.nombre`,
      [D]
    );
    // Marta (comodín 09-19, fuera de la lista fija) no se copia
    expect(jornadas.rows).toEqual([
      { nombre: 'Ana', turno: 'turnoA' },
      { nombre: 'Carlos', turno: 'turnoC' },
      { nombre: 'Luis', turno: 'turnoB' }
    ]);
    expect(await caso('INC-OLD')).toMatchObject({ tecnico_actual_id: ANA, estado: 'en_curso' });
    const r = await uno<{ n: number; origen: string }>(`select count(*)::int n, min(origen) origen from caso_responsables`);
    expect(r).toEqual({ n: 1, origen: 'migracion' });
    expect((await uno<{ n: number }>('select count(*)::int n from notificaciones')).n).toBe(0);
  });

  it('las jornadas validan el horario del comodín, el almuerzo y una por día', async () => {
    await expect(db.exec(`insert into jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin) values ('${D}','${MARTA}','comodin','09:00','19:00')`)).rejects.toThrow(/jornada_horario_comodin/);
    await expect(db.exec(`insert into jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin) values ('${D}','${MARTA}','turnoA','07:00','17:00')`)).rejects.toThrow(/jornada_horario_comodin/);
    await expect(db.exec(`insert into jornadas (fecha_operativa, tecnico_id, turno, almuerzo_inicio) values ('${D}','${MARTA}','turnoA','12:00')`)).rejects.toThrow(/jornada_almuerzo_completo/);
    await expect(db.exec(`insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${D}','${ANA}','turnoB')`)).rejects.toThrow(/jornada_unica_por_dia/);
  });

  it('solo el dispatch planifica jornadas', async () => {
    await como(U_ANA);
    await expect(db.exec(`insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${D1}','${ANA}','turnoA')`)).rejects.toThrow(/row-level security/);
    await como(U_DISPATCH);
    await db.exec(`insert into jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin) values ('${D1}','${MARTA}','comodin','07:00','17:00')`);
    await como(null);
    const b = await uno<{ accion: string; usuario_email: string; detalle: string }>(`select accion, usuario_email, detalle from bitacora where accion = 'jornada_planificada' order by created_at desc limit 1`);
    expect(b).toEqual({ accion: 'jornada_planificada', usuario_email: 'dispatch@noc.test', detalle: `${D1} · Comodín 07:00 - 17:00` });
  });

  it('el dispatch crea casos: se abre el responsable, se notifica y queda en bitácora', async () => {
    await como(U_ANA);
    await expect(db.exec(`insert into casos (codigo, tecnico_actual_id) values ('INC1','${ANA}')`)).rejects.toThrow(/row-level security/);

    await como(U_DISPATCH);
    await db.exec(`insert into casos (codigo, descripcion, tecnico_actual_id) values (' inc1 ','Caída fibra','${ANA}'), ('INC2', null, '${ANA}'), ('INC3', null, '${ANA}'), ('INC9', null, '${LUIS}')`);
    await expect(db.exec(`insert into casos (codigo) values ('INC1')`)).rejects.toThrow(/casos_codigo_unico/);
    await como(null);

    expect(await caso('INC1')).toMatchObject({ tecnico_actual_id: ANA, estado: 'en_curso' });
    const resp = await uno<{ origen: string; fecha: string; asignado_por: string }>(
      `select origen, fecha_operativa::text fecha, asignado_por from caso_responsables r join casos c on c.id = r.caso_id where c.codigo = 'INC1'`
    );
    expect(resp).toEqual({ origen: 'dispatch', fecha: D, asignado_por: 'dispatch@noc.test' });
    expect((await db.query(`select 1 from bitacora where accion = 'caso_creado' and codigo = 'INC1' and tecnico = 'Ana'`)).rows).toHaveLength(1);
  });

  it('cada técnico ve y marca solo sus notificaciones', async () => {
    await como(U_ANA);
    const mias = await db.query<{ tipo: string; detalle: string }>('select tipo, detalle from notificaciones order by detalle');
    expect(mias.rows).toEqual([
      { tipo: 'asignado', detalle: 'INC1' },
      { tipo: 'asignado', detalle: 'INC2' },
      { tipo: 'asignado', detalle: 'INC3' }
    ]);
    await db.exec(`update notificaciones set leida = true where detalle = 'INC1'`);
    await expect(db.exec(`update notificaciones set tipo = 'traspaso'`)).rejects.toThrow(/permission denied/);
    await expect(db.exec(`delete from notificaciones`)).rejects.toThrow(/permission denied/);

    await como(U_LUIS);
    expect((await db.query('select detalle from notificaciones')).rows).toEqual([{ detalle: 'INC9' }]);
    await como(null);
    expect((await uno<{ n: number }>('select count(*)::int n from notificaciones where leida')).n).toBe(1);
  });

  it('un técnico actualiza estado, etiqueta y última actualización solo de sus casos', async () => {
    await como(U_ANA);
    await db.exec(`update casos set estado = 'pausado', etiqueta = 'Monitoreo', ultima_actualizacion = 'Esperando al cliente' where codigo = 'INC1'`);
    await expect(db.exec(`update casos set tecnico_actual_id = '${LUIS}' where codigo = 'INC1'`)).rejects.toThrow(/Solo el dispatch/);
    await expect(db.exec(`update casos set descripcion = 'otra' where codigo = 'INC1'`)).rejects.toThrow(/Solo el dispatch/);
    await db.exec(`update casos set estado = 'cerrado' where codigo = 'INC9'`); // de Luis: RLS lo ignora
    await db.exec(`delete from casos where codigo = 'INC1'`); // sin política de borrado: no hace nada
    await como(null);

    expect(await caso('INC1')).toMatchObject({ estado: 'pausado', etiqueta: 'Monitoreo', ultima_actualizacion_por: 'ana@noc.test' });
    expect((await caso('INC9')).estado).toBe('en_curso');
    const acciones = await db.query<{ accion: string }>(`select accion from bitacora where codigo = 'INC1' order by created_at, id`);
    expect(acciones.rows.map((r) => r.accion)).toEqual(['caso_creado', 'estado_cambiado', 'etiqueta_cambiada', 'ultima_actualizacion']);
  });

  it('reasignar y reabrir mantienen el historial de responsables', async () => {
    await como(U_DISPATCH);
    await db.exec(`update casos set tecnico_actual_id = '${ANA}' where codigo = 'INC9'`);
    await pausa();
    await db.exec(`update casos set estado = 'cerrado' where codigo = 'INC9'`);
    await pausa();
    await db.exec(`update casos set estado = 'en_curso' where codigo = 'INC9'`);
    await como(null);

    const hist = await db.query<{ tecnico_nombre: string; origen: string; abierto: boolean }>(
      `select tecnico_nombre, origen, hasta is null abierto from caso_responsables r join casos c on c.id = r.caso_id where c.codigo = 'INC9' order by desde`
    );
    expect(hist.rows).toEqual([
      { tecnico_nombre: 'Luis', origen: 'dispatch', abierto: false },
      { tecnico_nombre: 'Ana', origen: 'reasignacion', abierto: false },
      { tecnico_nombre: 'Ana', origen: 'reapertura', abierto: true }
    ]);
    expect((await db.query(`select 1 from bitacora where accion = 'caso_reasignado' and detalle = 'De Luis a Ana'`)).rows).toHaveLength(1);
    // INC9 vuelve con Luis para el resto de pruebas
    await db.exec(`update casos set tecnico_actual_id = '${LUIS}' where codigo = 'INC9'`);
  });

  describe('traspasos', () => {
    let traspasoAna: string;
    const item = (codigo: string, campos: string) =>
      db.exec(`insert into traspaso_items (traspaso_id, caso_id, ${campos.split('=')[0]}) select '${traspasoAna}', id, ${campos.split('=')[1]} from casos where codigo = '${codigo}'`);

    beforeAll(async () => {
      await como(null);
      await db.exec(`insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${D1}','${ANA}','turnoA')`);
      await como(U_ANA);
      traspasoAna = (await uno<{ id: string }>(`insert into traspasos (de_tecnico_id, fecha_operativa) values ('${ANA}','${D}') returning id`)).id;
    });

    it('nadie más puede crear o enviar el traspaso de otro', async () => {
      await como(U_LUIS);
      await expect(db.exec(`insert into traspasos (de_tecnico_id, fecha_operativa) values ('${ANA}','${D1}')`)).rejects.toThrow(/row-level security/);
      await expect(db.query('select enviar_traspaso($1)', [traspasoAna])).rejects.toThrow(/no encontrado/);
      await como(U_ANA);
      await expect(db.exec(`update traspasos set estado = 'enviado' where id = '${traspasoAna}'`)).rejects.toThrow(/row-level security/);
    });

    it('no deja cerrar turno si quedan casos sin incluir (carga debe quedar en 0)', async () => {
      await expect(db.query('select enviar_traspaso($1)', [traspasoAna])).rejects.toThrow(/Quedan 4 caso\(s\)/);
    });

    it('valida receptor, turno permitido y última actualización', async () => {
      await item('INC1', `para_tecnico_id, estado, ultima_actualizacion='${LUIS}', 'pausado', 'Cliente confirma mañana'`);
      await item('INC2', `para_tecnico_id='${CARLOS}'`); // A no puede traspasar a C
      await item('INC3', `estado='cerrado'`);
      await item('INC-OLD', `para_tecnico_id, ultima_actualizacion='${LUIS}', 'Revisado'`);

      await expect(db.query('select enviar_traspaso($1)', [traspasoAna])).rejects.toThrow(/INC2 no está planificado en un turno que pueda recibir de Turno A/);
      await db.exec(`update traspaso_items set para_tecnico_id = '${MARTA}' where caso_id = (select id from casos where codigo = 'INC2')`);
      // Marta es comodín MAÑANA: A solo traspasa a comodín del mismo día
      await expect(db.query('select enviar_traspaso($1)', [traspasoAna])).rejects.toThrow(/INC2 no está planificado/);
      await db.exec(`update traspaso_items set para_tecnico_id = '${LUIS}' where caso_id = (select id from casos where codigo = 'INC2')`);
      await expect(db.query('select enviar_traspaso($1)', [traspasoAna])).rejects.toThrow(/INC2 necesita su última actualización/);
      await db.exec(`update traspaso_items set ultima_actualizacion = 'Sin novedad' where caso_id = (select id from casos where codigo = 'INC2')`);
    });

    it('al enviar, los casos pasan al receptor, se notifica y nada queda a medias', async () => {
      const { n } = await uno<{ n: number }>('select enviar_traspaso($1) n', [traspasoAna]);
      expect(n).toBe(3);
      await expect(db.query('select enviar_traspaso($1)', [traspasoAna])).rejects.toThrow(/ya fue enviado/);
      await expect(db.exec(`update traspaso_items set etiqueta = 'x' where traspaso_id = '${traspasoAna}'`)).resolves.toBeDefined();
      await como(null);

      expect((await uno<{ etiqueta: string | null }>(`select etiqueta from traspaso_items where caso_id = (select id from casos where codigo = 'INC1')`)).etiqueta).toBeNull();
      expect(await caso('INC1')).toMatchObject({ tecnico_actual_id: LUIS, estado: 'pausado' });
      expect(await caso('INC3')).toMatchObject({ tecnico_actual_id: ANA, estado: 'cerrado' });
      expect((await uno<{ n: number }>(`select count(*)::int n from casos where tecnico_actual_id = '${ANA}' and estado <> 'cerrado'`)).n).toBe(0);

      const r = await uno<{ origen: string; fecha: string }>(
        `select origen, fecha_operativa::text fecha from caso_responsables where caso_id = (select id from casos where codigo = 'INC1') and hasta is null`
      );
      expect(r).toEqual({ origen: 'traspaso', fecha: D });
      expect((await uno<{ n: number }>(`select count(*)::int n from notificaciones where tecnico_id = '${LUIS}' and tipo = 'traspaso'`)).n).toBe(3);
      expect(await uno(`select estado, turno_origen from traspasos where id = '${traspasoAna}'`)).toEqual({ estado: 'enviado', turno_origen: 'turnoA' });
      expect((await db.query(`select 1 from bitacora where accion = 'traspaso_enviado' and tecnico = 'Ana'`)).rows).toHaveLength(1);
    });

    it('el receptor ve lo que recibió, con la nota de quien entregó', async () => {
      await como(U_LUIS);
      const items = await db.query<{ ultima_actualizacion: string }>(`select ultima_actualizacion from traspaso_items order by ultima_actualizacion`);
      expect(items.rows.map((i) => i.ultima_actualizacion)).toEqual(['Cliente confirma mañana', 'Revisado', 'Sin novedad']);
      expect((await db.query('select 1 from traspasos')).rows).toHaveLength(1);
    });

    it('B traspasa a comodín del día siguiente con la fecha operativa del receptor', async () => {
      const t = (await uno<{ id: string }>(`insert into traspasos (de_tecnico_id, fecha_operativa) values ('${LUIS}','${D}') returning id`)).id;
      await db.exec(`
        insert into traspaso_items (traspaso_id, caso_id, para_tecnico_id, ultima_actualizacion)
        select '${t}', id, case when codigo = 'INC9' then '${ANA}'::uuid else '${MARTA}'::uuid end, 'ok'
        from casos where tecnico_actual_id = '${LUIS}' and estado <> 'cerrado'`);
      expect((await uno<{ n: number }>('select enviar_traspaso($1) n', [t])).n).toBe(4);
      await como(null);

      const fechas = await db.query<{ codigo: string; tecnico_nombre: string; fecha: string }>(
        `select c.codigo, r.tecnico_nombre, r.fecha_operativa::text fecha from caso_responsables r join casos c on c.id = r.caso_id where r.hasta is null and c.codigo in ('INC1','INC9') order by c.codigo`
      );
      // Marta es comodín de D+1; Ana es turno A de D+1
      expect(fechas.rows).toEqual([
        { codigo: 'INC1', tecnico_nombre: 'Marta', fecha: D1 },
        { codigo: 'INC9', tecnico_nombre: 'Ana', fecha: D1 }
      ]);
    });
  });

  it('el snapshot del día operativo muestra a cada caso con quien lo tuvo por última vez ese día', async () => {
    await como(null);
    await db.query('select generar_snapshot_operativo($1::date)', [D]);
    const { rows } = await db.query<{ nombre: string; turno: string; codigos: string[] }>(`
      select t->>'nombre' nombre, t->>'turno' turno,
             coalesce((select array_agg(i->>'codigo' order by i->>'codigo') from jsonb_array_elements(t->'incidentes') i), '{}') codigos
      from historial_snapshots, jsonb_array_elements(datos_panel) t
      where fecha = $1 order by 1`, [D]);

    expect(rows).toEqual([
      { nombre: 'Ana', turno: 'turnoA', codigos: ['INC3'] },
      { nombre: 'Carlos', turno: 'turnoC', codigos: [] },
      { nombre: 'Luis', turno: 'turnoB', codigos: ['INC-OLD', 'INC1', 'INC2', 'INC9'] }
    ]);
  });

  it('la app no puede generar snapshots, escribir responsables ni ver nada sin sesión', async () => {
    const p = await uno<{ snap: boolean; enviar: boolean; anon_enviar: boolean }>(`
      select has_function_privilege('authenticated', 'public.generar_snapshot_operativo(date)', 'execute') snap,
             has_function_privilege('authenticated', 'public.enviar_traspaso(uuid)', 'execute') enviar,
             has_function_privilege('anon', 'public.enviar_traspaso(uuid)', 'execute') anon_enviar`);
    expect(p).toEqual({ snap: false, enviar: true, anon_enviar: false });

    await como(U_DISPATCH);
    await expect(db.exec(`insert into caso_responsables (caso_id, tecnico_nombre, fecha_operativa, origen) select id, 'x', '${D}', 'dispatch' from casos limit 1`)).rejects.toThrow(/permission denied/);

    await db.exec('reset role; set role anon');
    for (const tabla of ['casos', 'jornadas', 'perfiles', 'traspasos', 'notificaciones']) {
      expect((await db.query(`select * from ${tabla}`)).rows, tabla).toHaveLength(0);
    }
    await como(null);
  });
});
