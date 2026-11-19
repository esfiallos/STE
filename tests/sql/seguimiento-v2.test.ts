// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';

describe('seguimiento del técnico (migración 06)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const paso of [MIGRACIONES.esquema, MIGRACIONES.v3, MIGRACIONES.v4, MIGRACIONES.corte, MIGRACIONES.seguimiento]) {
      await db.exec(paso());
    }
    await db.exec(MIGRACIONES.seguimiento()); // se puede ejecutar dos veces
    como = actuarComo(db);
    await db.exec(`
      insert into tecnicos (id, nombre) values ('${ANA}','Ana'), ('${LUIS}','Luis');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values (fecha_operativa(),'${ANA}','turnoA'), (fecha_operativa(),'${LUIS}','turnoB');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_ANA}'), ('${U_LUIS}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}','Ana','tecnico','${ANA}'), ('${U_LUIS}','Luis','tecnico','${LUIS}');
    `);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, tecnico_actual_id) values ('INC1','${ANA}'), ('INC2','${ANA}')`);
    await como(null);
  });

  it('la vista dice cómo llegó cada caso a su responsable y quién escribió la última actualización', async () => {
    await como(U_ANA, 'ana@noc.test');
    await db.exec(`update casos set ultima_actualizacion = 'Esperando proveedor' where codigo = 'INC1'`);
    const filas = await db.query<{ codigo: string; origen_responsable: string; ultima_actualizacion_por: string | null }>(
      `select codigo, origen_responsable, ultima_actualizacion_por from casos_abiertos order by codigo`
    );
    expect(filas.rows).toEqual([
      { codigo: 'INC1', origen_responsable: 'dispatch', ultima_actualizacion_por: 'ana@noc.test' },
      { codigo: 'INC2', origen_responsable: 'dispatch', ultima_actualizacion_por: null }
    ]);
  });

  it('después de un traspaso el receptor lo ve como "traspaso" y recibe la notificación', async () => {
    await como(U_ANA, 'ana@noc.test');
    const { id } = (await db.query<{ id: string }>(
      `insert into traspasos (de_tecnico_id, fecha_operativa) values ('${ANA}', fecha_operativa()) returning id`
    )).rows[0]!;
    await db.exec(`
      insert into traspaso_items (traspaso_id, caso_id, para_tecnico_id, ultima_actualizacion)
      select '${id}', c.id, '${LUIS}', 'Sigue en monitoreo' from casos c where c.tecnico_actual_id = '${ANA}'`);
    await db.query('select enviar_traspaso($1)', [id]);

    await como(U_LUIS, 'luis@noc.test');
    const vista = await db.query<{ origen_responsable: string }>(`select origen_responsable from casos_abiertos where tecnico_actual_id = '${LUIS}'`);
    expect(vista.rows.map((r) => r.origen_responsable)).toEqual(['traspaso', 'traspaso']);

    const avisos = await db.query<{ tipo: string; leida: boolean }>('select tipo, leida from notificaciones');
    expect(avisos.rows).toEqual([
      { tipo: 'traspaso', leida: false },
      { tipo: 'traspaso', leida: false }
    ]);
    await db.exec(`update notificaciones set leida = true where tecnico_id = '${LUIS}' and not leida`);
    expect((await db.query('select 1 from notificaciones where not leida')).rows).toHaveLength(0);
    await como(null);
  });
});
