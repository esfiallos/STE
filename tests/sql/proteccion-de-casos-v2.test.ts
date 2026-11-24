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
const SOFIA = '55555555-5555-5555-5555-555555555555';

describe('seguridad de lectura y casos sin traspaso (migración 16)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;
  let AYER: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const n = async (sql: string, params: unknown[] = []) => Number((await uno<{ n: number }>(sql, params)).n);
  const idDe = async (codigo: string) => (await uno<{ id: string }>('select id from casos where codigo = $1', [codigo])).id;
  /** Fin del turno de un técnico un día (texto ISO para comparar). */
  const fin = async (tecnico: string, fecha: string) =>
    (await uno<{ f: Date }>('select fin_de_turno($1, $2::date) f', [tecnico, fecha])).f;

  /** Pasa el tramo vigente de un caso a otro día (como si se lo hubieran asignado ese día). */
  async function moverTramo(codigo: string, fecha: string): Promise<void> {
    await como(null);
    await db.query(
      `update caso_responsables set fecha_operativa = $2::date, desde = desde - ($3::date - $2::date) * interval '1 day'
       where caso_id = $1 and hasta is null`,
      [await idDe(codigo), fecha, D]
    );
  }

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const m of ['esquema', 'v3', 'v4', 'corte', 'seguimiento', 'traspasos', 'coordinador', 'ronda', 'planificacion',
                     'tableroDelDia', 'seguimientoDescripcion', 'filtros', 'turnoC', 'traspasoPropio'] as const) {
      await db.exec(MIGRACIONES[m]());
    }
    await db.exec(MIGRACIONES.proteccion());
    await db.exec(MIGRACIONES.proteccion()); // se puede ejecutar dos veces
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    AYER = (await uno<{ d: string }>(`select ('${D}'::date - 1)::text d`)).d;

    await db.exec(`
      insert into tecnicos (id, nombre) values ('${LUIS}','Luis'), ('${PEDRO}','Pedro'), ('${SOFIA}','Sofía');
      -- Pedro: A ayer y A hoy · Luis: B hoy · Sofía: nada
      insert into jornadas (fecha_operativa, tecnico_id, turno) values
        ('${AYER}','${PEDRO}','turnoA'), ('${D}','${PEDRO}','turnoA'), ('${D}','${LUIS}','turnoB');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_COORD}'), ('${U_LUIS}'), ('${U_INTRUSO}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch'), ('${U_COORD}','Coord','coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_LUIS}','Luis','tecnico','${LUIS}');
    `);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, descripcion, tecnico_actual_id) values
      ('INC1','Uno','${PEDRO}'), ('INC2','Dos','${LUIS}'), ('INC3','Tres','${PEDRO}')`);
    await moverTramo('INC1', AYER);
    await moverTramo('INC3', AYER);
  });

  describe('lectura solo con perfil', () => {
    it('una cuenta sin perfil no lee casos, responsables, jornadas, técnicos ni la ronda', async () => {
      await como(U_INTRUSO, 'intruso@otro.test');
      expect(await n('select count(*) n from casos')).toBe(0);
      expect(await n('select count(*) n from casos_abiertos')).toBe(0);
      expect(await n('select count(*) n from caso_responsables')).toBe(0);
      expect(await n('select count(*) n from jornadas')).toBe(0);
      expect(await n('select count(*) n from tecnicos')).toBe(0);
      expect(await n('select count(*) n from tecnicos_de_la_ronda()')).toBe(0);
      expect(await n('select count(*) n from tablero_del_dia')).toBe(0);
    });

    it('con perfil (técnico, dispatch o coordinación) se sigue leyendo todo', async () => {
      for (const [uid, correo] of [[U_LUIS, 'luis@noc.test'], [U_DISPATCH, 'dispatch@noc.test'], [U_COORD, 'coord@noc.test']]) {
        await como(uid!, correo);
        expect(await n('select count(*) n from casos')).toBe(3);
        expect(await n('select count(*) n from tecnicos')).toBe(3);
        expect(await n('select count(*) n from jornadas')).toBe(3);
        expect(await n('select count(*) n from caso_responsables')).toBe(3);
      }
    });
  });

  describe('turno terminado sin traspaso', () => {
    it('marca el caso del turno de ayer que nadie traspasó (con la hora en que terminó ese turno)', async () => {
      await como(U_DISPATCH, 'dispatch@noc.test');
      const fila = await uno<{ s: Date | null }>(`select sin_traspaso_desde s from casos_abiertos where codigo = 'INC1'`);
      expect(fila.s?.getTime()).toBe((await fin(PEDRO, AYER)).getTime());
    });

    it('respeta la gracia de 30 minutos después del fin del turno', async () => {
      await como(null);
      const f = await fin(LUIS, D);
      const caso = await idDe('INC2');
      const tramo = await uno<{ desde: Date }>('select desde from caso_responsables where caso_id = $1 and hasta is null', [caso]);
      const a = (minutos: number) => new Date(f.getTime() + minutos * 60_000).toISOString();
      const sinTraspaso = async (ahora: string) =>
        (await uno<{ s: Date | null }>('select turno_sin_traspaso($1, $2::date, $3, $4) s', [LUIS, D, tramo.desde, ahora])).s;
      expect(await sinTraspaso(a(-60))).toBeNull(); // turno en curso
      expect(await sinTraspaso(a(10))).toBeNull(); // dentro de la gracia
      expect((await sinTraspaso(a(31)))?.getTime()).toBe(f.getTime());
    });

    it('sin jornada ese día no aplica (eso es "no trabaja hoy")', async () => {
      await como(null);
      expect(await uno(`select turno_sin_traspaso('${SOFIA}', '${AYER}'::date, now(), now() + interval '2 days') s`)).toEqual({ s: null });
    });

    it('un traspaso enviado ese día lo quita, salvo que el caso llegara después de enviarlo', async () => {
      await como(null);
      const { id } = await uno<{ id: string }>(
        `insert into traspasos (de_tecnico_id, fecha_operativa, estado, enviado_en) values ($1, $2, 'enviado', now()) returning id`,
        [PEDRO, AYER]
      );
      await como(U_DISPATCH, 'dispatch@noc.test');
      expect(await uno(`select sin_traspaso_desde s from casos_abiertos where codigo = 'INC1'`)).toEqual({ s: null });

      await como(null);
      const desde = await uno<{ d: Date }>(`select desde d from caso_responsables where caso_id = $1 and hasta is null`, [await idDe('INC1')]);
      await db.query(`update traspasos set enviado_en = $2::timestamptz - interval '1 hour' where id = $1`, [id, desde.d]);
      await como(U_DISPATCH, 'dispatch@noc.test');
      expect(await uno<{ s: Date | null }>(`select sin_traspaso_desde s from casos_abiertos where codigo = 'INC1'`))
        .not.toEqual({ s: null });

      await como(null);
      await db.query('delete from traspasos where id = $1', [id]);
    });
  });

  describe('vigilar_cierres_de_turno()', () => {
    it('crea una alerta por caso para coordinación, sin repetirla', async () => {
      await como(null);
      await db.exec('select vigilar_cierres_de_turno()');
      await db.exec('select vigilar_cierres_de_turno()');
      const alertas = (await db.query<{ detalle: string; tecnico_nombre: string; nivel: number | null }>(
        `select detalle, tecnico_nombre, nivel from alertas_coordinacion where tipo = 'turno_sin_traspaso' order by detalle`
      )).rows;
      expect(alertas).toEqual([
        { detalle: 'INC1', tecnico_nombre: 'Pedro', nivel: null },
        { detalle: 'INC3', tecnico_nombre: 'Pedro', nivel: null }
      ]);

      await como(U_COORD, 'coord@noc.test');
      expect(await n(`select count(*) n from alertas_coordinacion where tipo = 'turno_sin_traspaso'`)).toBe(2);
      await como(U_LUIS, 'luis@noc.test');
      expect(await n(`select count(*) n from alertas_coordinacion`)).toBe(0);
    });

    it('la alerta se da por leída cuando el dispatch reasigna el caso', async () => {
      await como(U_DISPATCH, 'dispatch@noc.test');
      await db.query(`update casos set tecnico_actual_id = $1 where codigo = 'INC3'`, [LUIS]);
      await como(null);
      await db.exec('select vigilar_cierres_de_turno()');
      expect(await uno(`select leida from alertas_coordinacion where tipo = 'turno_sin_traspaso' and detalle = 'INC3'`))
        .toEqual({ leida: true });
      expect(await uno(`select leida from alertas_coordinacion where tipo = 'turno_sin_traspaso' and detalle = 'INC1'`))
        .toEqual({ leida: false });
    });

    it('avisa al técnico 30 min antes del fin de su turno si tiene casos sin traspasar (una sola vez)', async () => {
      await como(null);
      const f = await fin(LUIS, D);
      const a = (minutos: number) => new Date(f.getTime() + minutos * 60_000).toISOString();
      const avisos = () => n(`select count(*) n from notificaciones where tipo = 'cierre_pendiente' and tecnico_id = '${LUIS}'`);

      await db.query('select vigilar_cierres_de_turno($1)', [a(-45)]);
      expect(await avisos()).toBe(0); // aún falta

      await db.query('select vigilar_cierres_de_turno($1)', [a(-20)]);
      await db.query('select vigilar_cierres_de_turno($1)', [a(-10)]);
      expect(await avisos()).toBe(1);
      const aviso = await uno<{ detalle: string; caso_id: string | null }>(
        `select detalle, caso_id from notificaciones where tipo = 'cierre_pendiente' and tecnico_id = '${LUIS}'`
      );
      expect(aviso.caso_id).toBeNull();
      expect(aviso.detalle).toMatch(/^tu turno termina a las 22:00 y tienes 2 caso\(s\) por traspasar$/);
    });

    it('no avisa si ya envió el traspaso', async () => {
      await como(null);
      await db.exec(`delete from notificaciones where tipo = 'cierre_pendiente'`);
      await db.query(`insert into traspasos (de_tecnico_id, fecha_operativa, estado, enviado_en) values ($1, $2, 'enviado', now())`, [LUIS, D]);
      const f = await fin(LUIS, D);
      await db.query('select vigilar_cierres_de_turno($1)', [new Date(f.getTime() - 10 * 60_000).toISOString()]);
      expect(await n(`select count(*) n from notificaciones where tipo = 'cierre_pendiente'`)).toBe(0);
    });
  });
});
