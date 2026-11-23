// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { HORARIOS_COMODIN, HORARIOS_TURNO_C } from '../../src/domain/shifts';
import { crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';
const MARTA = '33333333-3333-3333-3333-333333333333';
const RAUL = '44444444-4444-4444-4444-444444444444';

describe('turno C por tramos C1 / C2 (migración 14)', () => {
  let db: PGlite;
  let D: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const hora = async (fn: 'inicio_de_turno' | 'fin_de_turno', tecnico: string) =>
    (await uno<{ h: string }>(
      `select to_char(${fn}($1, $2::date) at time zone 'America/Tegucigalpa', 'YYYY-MM-DD HH24:MI') h`, [tecnico, D]
    )).h;
  const dia = (n: number) => {
    const f = new Date(`${D}T12:00:00Z`);
    f.setUTCDate(f.getUTCDate() + n);
    return f.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const m of ['esquema', 'v3', 'v4', 'corte', 'seguimiento', 'traspasos', 'coordinador', 'ronda',
                     'planificacion', 'tableroDelDia', 'seguimientoDescripcion', 'filtros'] as const) {
      await db.exec(MIGRACIONES[m]());
    }
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    // Antes de la 14: una jornada C sin horario (toda la noche)
    await db.exec(`
      insert into tecnicos (id, nombre) values ('${ANA}','Ana'), ('${LUIS}','Luis'), ('${MARTA}','Marta'), ('${RAUL}','Raúl');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${D}','${ANA}','turnoC');
    `);
    await db.exec(MIGRACIONES.turnoC());
    await db.exec(MIGRACIONES.turnoC()); // se puede ejecutar dos veces
  });

  it('la jornada C que no tenía horario queda como C1 + C2 (sin entrada en la bitácora)', async () => {
    expect(await uno(`select to_char(horario_inicio, 'HH24:MI') i, to_char(horario_fin, 'HH24:MI') f from jornadas where tecnico_id = '${ANA}'`))
      .toEqual({ i: '22:00', f: '06:00' });
    expect((await uno<{ n: number }>(`select count(*)::int n from bitacora where accion = 'jornada_modificada'`)).n).toBe(0);
  });

  it('acepta solo los tramos de C y los horarios de comodín del dominio', async () => {
    const tramos = (await db.query<{ inicio: string; fin: string; nombre: string }>(
      `select to_char(inicio, 'HH24:MI') inicio, to_char(fin, 'HH24:MI') fin, nombre from horarios_turno_c()`
    )).rows;
    expect(tramos).toEqual(HORARIOS_TURNO_C.map((h) => ({ ...h })));

    const intentar = (turno: string, i: string | null, f: string | null) =>
      db.query(`insert into jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin) values ($1, $2, $3, $4, $5)`,
        [dia(3), MARTA, turno, i, f]).then(() => db.exec(`delete from jornadas where tecnico_id = '${MARTA}'`));

    for (const h of HORARIOS_TURNO_C) await intentar('turnoC', h.inicio, h.fin);
    for (const h of HORARIOS_COMODIN) await intentar('comodin', h.inicio, h.fin);
    await intentar('turnoA', null, null);
    await expect(intentar('turnoC', null, null)).rejects.toThrow(/jornada_horario_valido/);
    await expect(intentar('turnoC', '23:00', '06:00')).rejects.toThrow(/jornada_horario_valido/);
    await expect(intentar('turnoB', '22:00', '00:00')).rejects.toThrow(/jornada_horario_valido/);
    await expect(intentar('comodin', '22:00', '06:00')).rejects.toThrow(/jornada_horario_valido/);
    await expect(intentar('comodin', null, null)).rejects.toThrow(/jornada_horario_valido/);
  });

  it('inicio y fin de turno siguen el tramo (C2 empieza a las 00:00 del día siguiente en el reloj)', async () => {
    await db.exec(`
      insert into jornadas (fecha_operativa, tecnico_id, turno, horario_inicio, horario_fin) values
        ('${D}','${LUIS}','turnoC','22:00','00:00'), ('${D}','${MARTA}','turnoC','00:00','06:00');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${D}','${RAUL}','turnoB');
    `);
    expect([await hora('inicio_de_turno', ANA), await hora('fin_de_turno', ANA)]).toEqual([`${D} 22:00`, `${dia(1)} 06:00`]);
    expect([await hora('inicio_de_turno', LUIS), await hora('fin_de_turno', LUIS)]).toEqual([`${D} 22:00`, `${dia(1)} 00:00`]);
    expect([await hora('inicio_de_turno', MARTA), await hora('fin_de_turno', MARTA)]).toEqual([`${dia(1)} 00:00`, `${dia(1)} 06:00`]);
    expect([await hora('inicio_de_turno', RAUL), await hora('fin_de_turno', RAUL)]).toEqual([`${D} 14:00`, `${D} 22:00`]);
  });

  it('la ronda solo toma al tramo de C que está en horario', async () => {
    const ronda = async (h: string) =>
      (await db.query<{ nombre: string }>(
        `select nombre from tecnicos_de_la_ronda(((('${D}'::date + case when $1::time < '06:00' then 1 else 0 end) + $1::time)::timestamp at time zone 'America/Tegucigalpa'))`,
        [h]
      )).rows.map((r) => r.nombre);
    expect(await ronda('23:00')).toEqual(['Ana', 'Luis']);
    expect(await ronda('01:00')).toEqual(['Ana', 'Marta']);
    expect(await ronda('15:00')).toEqual(['Raúl']);
  });

  it('describe cada tramo en la bitácora y los traspasos siguen siendo "turno C"', async () => {
    const d = async (i: string | null, f: string | null) => (await uno<{ t: string }>(`select describir_turno('turnoC', $1::time, $2::time) t`, [i, f])).t;
    expect(await d('22:00', '00:00')).toBe('Turno C1 22:00 - 00:00');
    expect(await d('00:00', '06:00')).toBe('Turno C2 00:00 - 06:00');
    expect(await d('22:00', '06:00')).toBe('Turno C1 + C2 22:00 - 06:00');
    expect(await d(null, null)).toBe('Turno C');
    expect((await uno<{ b: number; c: number }>(`select desfase_traspaso('turnoB', 'turnoC') b, desfase_traspaso('turnoC', 'turnoA') c`)))
      .toEqual({ b: 0, c: 1 });
  });
});
