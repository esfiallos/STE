import { describe, expect, it } from 'vitest';
import {
  DESTINOS_DE_TRASPASO,
  debeTraspasarse,
  desfaseDeTraspaso,
  puedeRecibirTraspaso
} from '../../src/domain/handover';
import { esHorarioComodinValido } from '../../src/domain/shifts';
import { fechaOperativa, sumarDias } from '../../src/domain/time';

const a = (dia: number, h: number, m = 0) => new Date(2026, 10, dia, h, m);

describe('día operativo (06:00 → 06:00)', () => {
  it('antes de las 06:00 sigue siendo el día anterior (turno C)', () => {
    expect(fechaOperativa(a(18, 5, 59))).toBe('2026-11-17');
    expect(fechaOperativa(a(18, 0, 0))).toBe('2026-11-17');
    expect(fechaOperativa(a(18, 6, 0))).toBe('2026-11-18');
    expect(fechaOperativa(a(18, 23, 59))).toBe('2026-11-18');
  });

  it('cruza meses y años', () => {
    expect(fechaOperativa(new Date(2026, 11, 1, 3))).toBe('2026-11-30');
    expect(fechaOperativa(new Date(2027, 0, 1, 2))).toBe('2026-12-31');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('destinos de traspaso', () => {
  it('A traspasa solo a B y comodín del mismo día', () => {
    expect(desfaseDeTraspaso('turnoA', 'turnoB')).toBe(0);
    expect(desfaseDeTraspaso('turnoA', 'comodin')).toBe(0);
    expect(desfaseDeTraspaso('turnoA', 'turnoC')).toBeNull();
    expect(desfaseDeTraspaso('turnoA', 'turnoA')).toBeNull();
  });

  it('B y comodín: C el mismo día; A y comodín el día siguiente', () => {
    for (const origen of ['turnoB', 'comodin'] as const) {
      expect(desfaseDeTraspaso(origen, 'turnoC')).toBe(0);
      expect(desfaseDeTraspaso(origen, 'turnoA')).toBe(1);
      expect(desfaseDeTraspaso(origen, 'comodin')).toBe(1);
    }
    expect(desfaseDeTraspaso('turnoB', 'turnoB')).toBeNull();
  });

  it('C traspasa a A y comodín del día siguiente', () => {
    expect(DESTINOS_DE_TRASPASO.turnoC.map((d) => d.turno)).toEqual(['turnoA', 'comodin']);
    expect(desfaseDeTraspaso('turnoC', 'turnoB')).toBeNull();
  });

  it('valida al receptor por turno y fecha', () => {
    expect(puedeRecibirTraspaso('turnoB', '2026-11-18', 'turnoA', '2026-11-19')).toBe(true);
    expect(puedeRecibirTraspaso('turnoB', '2026-11-18', 'turnoA', '2026-11-18')).toBe(false);
    expect(puedeRecibirTraspaso('turnoA', '2026-11-18', 'comodin', '2026-11-18')).toBe(true);
    expect(puedeRecibirTraspaso('turnoA', '2026-11-18', 'comodin', '2026-11-19')).toBe(false);
  });

  it('todo caso no cerrado se traspasa', () => {
    expect(debeTraspasarse('en_curso')).toBe(true);
    expect(debeTraspasarse('pausado')).toBe(true);
    expect(debeTraspasarse('resuelto')).toBe(true);
    expect(debeTraspasarse('cerrado')).toBe(false);
  });
});

describe('horarios de comodín', () => {
  it('solo acepta los horarios fijos', () => {
    expect(esHorarioComodinValido('07:00', '17:00')).toBe(true);
    expect(esHorarioComodinValido('06:00:00', '16:00:00')).toBe(true);
    expect(esHorarioComodinValido('09:00', '19:00')).toBe(false);
  });
});
