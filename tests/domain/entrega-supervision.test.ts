import { describe, expect, it } from 'vitest';
import { receptoresParaEntregar, repartirEntrega, turnoTerminado } from '../../src/domain/supervisionHandover';
import type { Jornada, TecnicoCatalogo } from '../../src/types/noc';

const HOY = '2026-11-09';
const MANANA = '2026-11-10';
const a = (hora: number, minutos = 0, dia = 9) => new Date(2026, 10, dia, hora, minutos);
const j = (tecnicoId: string, turno: Jornada['turno'], fecha = HOY, horario: [string, string] | null = null): Jornada => ({
  id: `${tecnicoId}-${fecha}`, fecha, tecnicoId, turno, horarioInicio: horario?.[0] ?? null, horarioFin: horario?.[1] ?? null, almuerzoInicio: null, almuerzoFin: null
});

describe('turno terminado (mismo criterio que fin_de_turno)', () => {
  it('turnos fijos, comodín y tramos de C, también pasada la medianoche', () => {
    expect([turnoTerminado(j('a', 'turnoA'), HOY, a(13, 59)), turnoTerminado(j('a', 'turnoA'), HOY, a(14))]).toEqual([false, true]);
    expect(turnoTerminado(j('m', 'comodin', HOY, ['07:00', '17:00']), HOY, a(16, 30))).toBe(false);
    // C1 22–00: a las 00:30 (mismo día operativo) ya terminó; C2 00–06 y C completo no terminan hasta las 06:00
    expect(turnoTerminado(j('c', 'turnoC', HOY, ['22:00', '00:00']), HOY, a(0, 30, 10))).toBe(true);
    expect(turnoTerminado(j('c', 'turnoC', HOY, ['00:00', '06:00']), HOY, a(5, 59, 10))).toBe(false);
    expect(turnoTerminado(j('c', 'turnoC'), HOY, a(23))).toBe(false);
    // Mañana nunca terminó; ayer, siempre
    expect(turnoTerminado(j('a', 'turnoA', MANANA), HOY, a(23))).toBe(false);
    expect(turnoTerminado(j('a', 'turnoA', '2026-11-08'), HOY, a(7))).toBe(true);
  });
});

describe('a quién se entrega y cómo se reparte (D37)', () => {
  const catalogo: TecnicoCatalogo[] = [
    { id: 'ana', nombre: 'Ana', activo: true }, { id: 'luis', nombre: 'Luis', activo: true },
    { id: 'baja', nombre: 'Baja', activo: false }, { id: 'zoe', nombre: 'Zoe', activo: true }
  ] as TecnicoCatalogo[];
  const jornadas = [j('ana', 'turnoA'), j('luis', 'turnoB'), j('baja', 'turnoB'), j('zoe', 'turnoA', MANANA), j('ana', 'turnoA', '2026-11-11')];

  it('solo activos, de hoy (con el turno sin terminar) o de mañana', () => {
    expect(receptoresParaEntregar(jornadas, catalogo, HOY, a(15)).map((r) => `${r.nombre} ${r.fecha}`)).toEqual([`Luis ${HOY}`, `Zoe ${MANANA}`]);
    expect(receptoresParaEntregar(jornadas, catalogo, HOY, a(9)).map((r) => r.nombre)).toEqual(['Ana', 'Luis', 'Zoe']);
  });

  it('reparte parejo y lleva la fecha de la jornada de cada receptor', () => {
    const receptores = receptoresParaEntregar(jornadas, catalogo, HOY, a(15));
    const casos = [{ id: '1', codigo: 'INC1' }, { id: '2', codigo: 'INC2' }, { id: '3', codigo: 'SCTASK3' }];
    const entregas = repartirEntrega(casos, receptores);
    expect(entregas).toHaveLength(3);
    const porTecnico = (id: string) => entregas.filter((e) => e.tecnicoId === id);
    expect([porTecnico('luis').length, porTecnico('zoe').length].sort()).toEqual([1, 2]);
    expect(porTecnico('zoe').every((e) => e.fecha === MANANA)).toBe(true);
    expect(repartirEntrega(casos, [])).toEqual([]);
  });
});
