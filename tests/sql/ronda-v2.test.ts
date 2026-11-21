// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { claveDeRonda, siguienteEnRonda, turnoEnCurso } from '../../src/domain/round';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const T = {
  carla: '11111111-1111-1111-1111-111111111111',
  ana: '22222222-2222-2222-2222-222222222222',
  beto: '33333333-3333-3333-3333-333333333333',
  alvaro: '44444444-4444-4444-4444-444444444444'
};
const NOMBRES: Record<string, string> = { [T.carla]: 'Carla Díaz', [T.ana]: 'ana Pérez', [T.beto]: 'Beto Ruiz', [T.alvaro]: 'Álvaro Gómez' };

describe('asignar a la ronda (migración 09)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const asignar = async (codigo: string) =>
    (await uno<{ tecnico_nombre: string }>('select tecnico_nombre from asignar_a_ronda($1, $2)', [codigo, 'nota'])).tecnico_nombre;

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const paso of [MIGRACIONES.esquema, MIGRACIONES.v3, MIGRACIONES.v4, MIGRACIONES.corte, MIGRACIONES.seguimiento, MIGRACIONES.traspasos, MIGRACIONES.coordinador]) {
      await db.exec(paso());
    }
    await db.exec(MIGRACIONES.ronda());
    await db.exec(MIGRACIONES.ronda()); // se puede ejecutar dos veces
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;

    // Todos trabajan en el turno que está en curso ahora (así están "en horario" sin depender de la hora real)
    await db.exec(`
      insert into tecnicos (id, nombre) values ${Object.entries(NOMBRES).map(([id, n]) => `('${id}','${n}')`).join(', ')};
      insert into jornadas (fecha_operativa, tecnico_id, turno) select fecha_operativa(), id, turno_en_curso() from tecnicos;
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_COORD}'), ('${U_ANA}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch'), ('${U_COORD}','Coordinación','coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}','Ana','tecnico','${T.ana}');
    `);
  });

  it('la clave de orden y el turno en curso coinciden con el dominio', async () => {
    for (const nombre of ['Álvaro Gómez', '  ana   Pérez ', 'Ñoño Ürsula', 'ZOE', 'Íñigo Óscar']) {
      const { clave } = await uno<{ clave: string }>('select clave_de_ronda($1) clave', [nombre]);
      expect(clave).toBe(claveDeRonda(nombre));
    }
    for (const [h, m] of [[5, 59], [6, 0], [13, 59], [14, 0], [21, 59], [22, 0], [0, 30]] as const) {
      const hora = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const { turno } = await uno<{ turno: string }>(
        `select turno_en_curso(('${D}'::date + time '${hora}')::timestamp at time zone 'America/Tegucigalpa') turno`
      );
      expect(turno).toBe(turnoEnCurso(new Date(2026, 10, 9, h, m)));
    }
  });

  it('rota en orden alfabético (sin acentos ni mayúsculas) y vuelve al primero, igual que el dominio', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    const elegidos = [];
    for (let i = 1; i <= 5; i++) elegidos.push(await asignar(`inc-r${i}`));
    expect(elegidos).toEqual(['Álvaro Gómez', 'ana Pérez', 'Beto Ruiz', 'Carla Díaz', 'Álvaro Gómez']);

    const candidatos = Object.entries(NOMBRES).map(([id, nombre]) => ({ id, nombre }));
    let ultimo: string | null = null;
    const simulados = [];
    for (let i = 0; i < 5; i++) {
      ultimo = siguienteEnRonda(candidatos, ultimo)!.nombre;
      simulados.push(ultimo);
    }
    expect(simulados).toEqual(elegidos);

    const caso = await uno<{ codigo: string; tecnico_actual_id: string; nota: string }>(`select codigo, tecnico_actual_id, nota from casos where codigo = 'INC-R2'`);
    expect(caso).toEqual({ codigo: 'INC-R2', tecnico_actual_id: T.ana, nota: 'nota' });
    await como(null);
    const r = await uno<{ origen: string }>(`select origen from caso_responsables where caso_id = (select id from casos where codigo = 'INC-R2')`);
    expect(r.origen).toBe('dispatch');
    expect((await db.query(`select 1 from bitacora where accion = 'asignado_por_ronda'`)).rows).toHaveLength(5);
    expect((await db.query(`select 1 from notificaciones where tecnico_id = '${T.ana}'`)).rows).toHaveLength(1);
  });

  it('salta a quien está en almuerzo y asignar a mano no mueve el puntero', async () => {
    // Último: Álvaro. Ana sale a almorzar ahora → le toca a Beto
    await db.exec(`update jornadas set almuerzo_inicio = (now() at time zone 'America/Tegucigalpa')::time - interval '5 minutes',
                                       almuerzo_fin    = (now() at time zone 'America/Tegucigalpa')::time + interval '25 minutes'
                   where tecnico_id = '${T.ana}'`);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, tecnico_actual_id) values ('INC-MANUAL', '${T.carla}')`);
    expect(await asignar('INC-R6')).toBe('Beto Ruiz');
    expect(await asignar('INC-R7')).toBe('Carla Díaz');
    expect(await asignar('INC-R8')).toBe('Álvaro Gómez');
    expect(await asignar('INC-R9')).toBe('Beto Ruiz');
    await como(null);
    await db.exec(`update jornadas set almuerzo_inicio = null, almuerzo_fin = null`);
  });

  it('rechaza códigos repetidos, a quien no es dispatch y cuando nadie está disponible', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(asignar(' inc-r1 ')).rejects.toThrow(/INC-R1 ya existe/);
    await expect(asignar('  ')).rejects.toThrow(/número de incidente/);
    await como(U_ANA, 'ana@noc.test');
    await expect(asignar('INC-X')).rejects.toThrow(/Solo el dispatch/);

    await como(null);
    await db.exec(`update tecnicos set activo = false`);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(asignar('INC-Y')).rejects.toThrow(/No hay técnicos disponibles/);
    expect((await db.query(`select 1 from casos where codigo = 'INC-Y'`)).rows).toHaveLength(0);
    await como(null);
    await db.exec(`update tecnicos set activo = true`);
  });

  it('el puntero lo leen dispatch y coordinación; nadie lo escribe desde la app', async () => {
    await como(U_COORD, 'coord@noc.test');
    const fila = await uno<{ ultimo_nombre: string; turno: string }>('select ultimo_nombre, turno from ronda_estado');
    expect(fila.ultimo_nombre).toBe('Beto Ruiz');
    await como(U_ANA, 'ana@noc.test');
    expect((await db.query('select 1 from ronda_estado')).rows).toHaveLength(0);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(db.exec(`update ronda_estado set ultimo_nombre = 'x'`)).rejects.toThrow(/permission denied/);
    await como(null);
  });
});
