import { describe, expect, it } from 'vitest';
import { RESPALDO_CON_REALTIME_MS, tocaRelecturaDeRespaldo } from '../../src/domain/refresco';

describe('relectura de respaldo', () => {
  it('sin Realtime relee en cada revisión', () => {
    expect(tocaRelecturaDeRespaldo('desconectado', 0)).toBe(true);
    expect(tocaRelecturaDeRespaldo('conectando', 10_000)).toBe(true);
  });

  it('con Realtime conectado solo relee si pasaron 5 minutos desde la última lectura', () => {
    expect(tocaRelecturaDeRespaldo('conectado', 60_000)).toBe(false);
    expect(tocaRelecturaDeRespaldo('conectado', RESPALDO_CON_REALTIME_MS - 1)).toBe(false);
    expect(tocaRelecturaDeRespaldo('conectado', RESPALDO_CON_REALTIME_MS)).toBe(true);
  });
});
