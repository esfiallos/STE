// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { AREAS_DE_CASO } from '../../src/domain/areas';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_ANA = 'a0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';

describe('casos y traspasos (migración 07)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  /** Momento (Honduras) del día operativo D a la hora indicada, como timestamptz. */
  const a = (hora: string, dias = 0) => `(('${D}'::date + ${dias}) + time '${hora}')::timestamp at time zone 'America/Tegucigalpa'`;

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const paso of [MIGRACIONES.esquema, MIGRACIONES.v3, MIGRACIONES.v4, MIGRACIONES.corte, MIGRACIONES.seguimiento]) {
      await db.exec(paso());
    }
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;
    await db.exec(`
      insert into tecnicos (id, nombre) values ('${ANA}','Ana'), ('${LUIS}','Luis');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values ('${D}','${ANA}','turnoA'), ('${D}','${LUIS}','turnoB');
      insert into auth.users (id) values ('${U_DISPATCH}'), ('${U_ANA}'), ('${U_LUIS}');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_ANA}','Ana','tecnico','${ANA}'), ('${U_LUIS}','Luis','tecnico','${LUIS}');
    `);
    // Un caso viejo con un área que ya no existe en el catálogo
    await db.exec(`insert into casos (codigo, area, tecnico_actual_id) values ('INC-VIEJO','DATACENTER','${LUIS}')`);

    await db.exec(MIGRACIONES.traspasos());
    await db.exec(MIGRACIONES.traspasos()); // se puede ejecutar dos veces

    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, nota, tecnico_actual_id) values ('INC1','ACME · enlace 4410','${ANA}'), ('INC2', null,'${ANA}')`);
    await como(null);
  });

  it('el catálogo de áreas de la base coincide con el del dominio', async () => {
    const { areas } = await uno<{ areas: string[] }>('select areas_de_caso() areas');
    expect(areas).toEqual([...AREAS_DE_CASO]);
  });

  it('un área fuera del catálogo queda vacía y se anota en la bitácora', async () => {
    expect((await uno<{ area: string | null }>(`select area from casos where codigo = 'INC-VIEJO'`)).area).toBeNull();
    const fila = await uno<{ detalle: string }>(`select detalle from bitacora where accion = 'area_descartada'`);
    expect(fila.detalle).toContain('DATACENTER');
    await expect(db.exec(`update casos set area = 'DATACENTER' where codigo = 'INC1'`)).rejects.toThrow(/casos_area_valida/);
  });

  it('el técnico registra área y empresa de sus casos y eso cuenta como actividad', async () => {
    await como(U_ANA, 'ana@noc.test');
    await db.exec(`update casos set area = 'CORE IP', cliente = '  ACME  ' where codigo = 'INC1'`);
    await expect(db.exec(`update casos set descripcion = 'otra' where codigo = 'INC1'`)).rejects.toThrow(/Solo el dispatch/);
    await expect(db.exec(`update casos set recordatorio_fecha = '${D}' where codigo = 'INC1'`)).rejects.toThrow(/Solo el dispatch/);
    await expect(db.exec(`update casos set area = 'NADA' where codigo = 'INC1'`)).rejects.toThrow(/casos_area_valida/);
    await como(null);

    const inc1 = await uno<{ area: string; cliente: string; actividad: boolean }>(
      `select area, cliente, actividad_tecnico_en is not null actividad from casos where codigo = 'INC1'`
    );
    expect(inc1).toEqual({ area: 'CORE IP', cliente: 'ACME', actividad: true });
    const acciones = await db.query<{ accion: string }>(`select accion from bitacora where codigo = 'INC1' order by created_at, id`);
    // Área y empresa se registran en el mismo UPDATE: pueden tener la misma hora, así que su orden no importa.
    const [primera, ...resto] = acciones.rows.map((r) => r.accion);
    expect(primera).toBe('caso_creado');
    expect(resto.sort()).toEqual(['area_cambiada', 'empresa_cambiada']);

    // Lo que hace el dispatch no cuenta como actividad del técnico
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`update casos set nota = 'Cambio del dispatch' where codigo = 'INC2'`);
    await como(null);
    expect((await uno<{ a: string | null }>(`select actividad_tecnico_en a from casos where codigo = 'INC2'`)).a).toBeNull();

    const vista = await uno<{ actividad_tecnico_en: string | null; recordatorio_fecha: string | null }>(
      `select actividad_tecnico_en, recordatorio_fecha from casos_abiertos where codigo = 'INC1'`
    );
    expect(vista.actividad_tecnico_en).not.toBeNull();
    expect(vista.recordatorio_fecha).toBeNull();
  });

  describe('traspaso con recordatorio', () => {
    let traspaso: string;
    const fijarItem = (codigo: string, campos: string) =>
      db.exec(`update traspaso_items set ${campos} where caso_id = (select id from casos where codigo = '${codigo}')`);

    beforeAll(async () => {
      await como(U_ANA, 'ana@noc.test');
      traspaso = (await uno<{ id: string }>(`insert into traspasos (de_tecnico_id, fecha_operativa) values ('${ANA}','${D}') returning id`)).id;
      await db.exec(`
        insert into traspaso_items (traspaso_id, caso_id, para_tecnico_id, ultima_actualizacion)
        select '${traspaso}', id, '${LUIS}', 'Sigue en monitoreo' from casos where tecnico_actual_id = '${ANA}'`);
    });

    it('valida que el recordatorio tenga fecha y que no sea pasada', async () => {
      await fijarItem('INC1', `recordatorio_texto = 'VM programada'`);
      await expect(db.query('select enviar_traspaso($1)', [traspaso])).rejects.toThrow(/INC1 necesita una fecha/);
      await fijarItem('INC1', `recordatorio_fecha = '${D}'::date - 1`);
      await expect(db.query('select enviar_traspaso($1)', [traspaso])).rejects.toThrow(/INC1 tiene una fecha pasada/);
      await fijarItem('INC1', `recordatorio_fecha = '${D}'`);
      await fijarItem('INC2', `recordatorio_fecha = '${D}'::date + 1, recordatorio_texto = '  '`);
    });

    it('al enviar, el recordatorio pasa al caso y el ítem guarda el día en que lo recibió el receptor', async () => {
      expect((await uno<{ n: number }>('select enviar_traspaso($1) n', [traspaso])).n).toBe(2);
      await como(null);

      const casos = await db.query<{ codigo: string; recordatorio_fecha: string; recordatorio_texto: string | null }>(
        `select codigo, recordatorio_fecha::text, recordatorio_texto from casos where codigo in ('INC1','INC2') order by codigo`
      );
      expect(casos.rows).toEqual([
        { codigo: 'INC1', recordatorio_fecha: D, recordatorio_texto: 'VM programada' },
        { codigo: 'INC2', recordatorio_fecha: (await uno<{ d: string }>(`select ('${D}'::date + 1)::text d`)).d, recordatorio_texto: null }
      ]);
      const destinos = await db.query<{ f: string }>(`select fecha_destino::text f from traspaso_items where traspaso_id = '${traspaso}'`);
      expect(destinos.rows.map((r) => r.f)).toEqual([D, D]);
    });

    it('avisa al inicio del turno de quien tiene el caso, una sola vez', async () => {
      await como(null);
      // Luis es turno B: el recordatorio de hoy sale a las 14:00
      expect((await uno<{ n: number }>(`select generar_recordatorios(${a('13:55')}) n`)).n).toBe(0);
      expect((await uno<{ n: number }>(`select generar_recordatorios(${a('14:00')}) n`)).n).toBe(1);
      expect((await uno<{ n: number }>(`select generar_recordatorios(${a('14:05')}) n`)).n).toBe(0);
      // INC2 es para mañana y Luis no tiene jornada ese día: sale a las 06:00
      expect((await uno<{ n: number }>(`select generar_recordatorios(${a('05:55', 1)}) n`)).n).toBe(0);
      expect((await uno<{ n: number }>(`select generar_recordatorios(${a('06:00', 1)}) n`)).n).toBe(1);

      await como(U_LUIS, 'luis@noc.test');
      const avisos = await db.query<{ detalle: string }>(`select detalle from notificaciones where tipo = 'recordatorio' order by creado_en`);
      expect(avisos.rows.map((r) => r.detalle)).toEqual(['INC1: VM programada', 'INC2']);
      await como(null);
    });

    it('cambiar el recordatorio lo vuelve a dejar pendiente', async () => {
      await db.exec(`update casos set recordatorio_texto = 'VM reprogramada' where codigo = 'INC1'`);
      expect((await uno<{ n: number }>(`select generar_recordatorios(${a('15:00')}) n`)).n).toBe(1);
    });

    it('la app no puede generar recordatorios', async () => {
      await como(U_LUIS, 'luis@noc.test');
      await expect(db.query('select generar_recordatorios()')).rejects.toThrow(/permission denied/);
      await como(null);
    });
  });
});
