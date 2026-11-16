import { describe, expect, it } from 'vitest';
import { aMinutos, esRangoValido, estaDentroDelRango, formatearFechaLocal, rangosSeSolapan } from '../../src/domain/time';

const a = (h: number, m = 0) => new Date(2026, 10, 9, h, m);

describe('horas', () => {
  it('convierte HH:MM y HH:MM:SS a minutos', () => {
    expect(aMinutos('12:30')).toBe(750);
    expect(aMinutos('12:30:00')).toBe(750);
    expect(aMinutos('25:00')).toBeNull();
    expect(aMinutos('abc')).toBeNull();
  });

  it('el rango incluye el inicio y excluye el fin', () => {
    expect(estaDentroDelRango('12:00', '12:30', a(12, 0))).toBe(true);
    expect(estaDentroDelRango('12:00', '12:30', a(12, 29))).toBe(true);
    expect(estaDentroDelRango('12:00', '12:30', a(12, 30))).toBe(false);
  });

  it('soporta rangos que cruzan la medianoche', () => {
    expect(estaDentroDelRango('22:00', '06:00', a(23))).toBe(true);
    expect(estaDentroDelRango('22:00', '06:00', a(3))).toBe(true);
    expect(estaDentroDelRango('22:00', '06:00', a(12))).toBe(false);
  });

  it('valida rangos', () => {
    expect(esRangoValido('08:00', '18:00')).toBe(true);
    expect(esRangoValido('08:00', '08:00')).toBe(false);
    expect(esRangoValido('', '08:00')).toBe(false);
  });

  it('detecta si dos rangos se solapan', () => {
    expect(rangosSeSolapan('07:00', '17:00', '06:00', '14:00')).toBe(true);
    expect(rangosSeSolapan('07:00', '17:00', '14:00', '22:00')).toBe(true);
    expect(rangosSeSolapan('07:00', '17:00', '22:00', '06:00')).toBe(false);
    expect(rangosSeSolapan('20:00', '04:00', '22:00', '06:00')).toBe(true);
    expect(rangosSeSolapan('06:00', '14:00', '14:00', '22:00')).toBe(false); // se tocan, no se solapan
  });

  it('la fecha del snapshot es la local, no la UTC', () => {
    expect(formatearFechaLocal(new Date(2026, 10, 9, 23, 30))).toBe('2026-11-09');
  });
});
