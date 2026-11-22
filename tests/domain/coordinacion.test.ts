import { describe, expect, it } from 'vitest';
import { alertasActivas, alertasHermanas, describirAlerta, gravedadDeAlerta, porcentaje, resumirEstadisticas } from '../../src/domain/coordination';
import type { AlertaCoordinacion } from '../../src/types/noc';

const alerta = (id: string, casoId: string, nivel: 2 | 4 | 6 | null, extra: Partial<AlertaCoordinacion> = {}): AlertaCoordinacion => ({
  id,
  tipo: nivel === null ? 'recordatorio_sin_jornada' : 'sin_actualizacion',
  casoId,
  tecnicoId: 'ana',
  tecnicoNombre: 'Ana Pérez',
  nivel,
  referencia: '2026-11-09T12:30:00Z',
  detalle: casoId.toUpperCase(),
  leida: false,
  creadoEn: `2026-11-09T1${nivel ?? 0}:00:00Z`,
  ...extra
});

describe('estadísticas del día', () => {
  it('completa los estados que faltan y suma el total', () => {
    const r = resumirEstadisticas([{ estado: 'en_curso', total: 3 }, { estado: 'cerrado', total: 2 }]);
    expect(r).toEqual({ total: 5, porEstado: { en_curso: 3, pausado: 0, resuelto: 0, cerrado: 2 } });
    expect(porcentaje(2, 5)).toBe(40);
    expect(porcentaje(1, 0)).toBe(0);
  });
});

describe('alertas de coordinación', () => {
  it('describe cada tipo de alerta', () => {
    expect(describirAlerta(alerta('1', 'inc1', 4))).toBe('INC1: 4 h sin actualización de Ana Pérez');
    expect(describirAlerta(alerta('2', 'inc2', null, { detalle: 'INC2: VM 10:00' }))).toBe('Recordatorio de INC2: VM 10:00 y Ana Pérez no tiene turno ese día');
    expect([gravedadDeAlerta(alerta('a', 'x', 2)), gravedadDeAlerta(alerta('b', 'x', 4)), gravedadDeAlerta(alerta('c', 'x', 6))]).toEqual(['aviso', 'alta', 'critica']);
  });

  it('muestra una por caso (la de más horas), las más graves primero, sin las atendidas', () => {
    const lista = [
      alerta('a', 'inc1', 2),
      alerta('b', 'inc1', 4),
      alerta('c', 'inc2', 2),
      alerta('d', 'inc3', 6, { leida: true }),
      alerta('e', 'inc4', null)
    ];
    expect(alertasActivas(lista).map((a) => a.id)).toEqual(['b', 'c', 'e']);
    expect(alertasHermanas(lista, lista[1]!)).toEqual(['a', 'b']);
  });
});
