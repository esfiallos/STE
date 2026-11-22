import { describe, expect, it } from 'vitest';
import { cambiosDelTablero, fotoDelTablero, hayCambios } from '../../src/domain/boardChanges';

const foto = (fecha: string, casos: [string, string | null][]) => fotoDelTablero(fecha, casos.map(([id, tecnicoId]) => ({ id, tecnicoId })));

describe('qué animar en el tablero', () => {
  const antes = foto('2026-11-09', [['i1', 'ana'], ['i2', 'luis'], ['i3', null]]);

  it('el primer dibujo y el cambio de día operativo no animan nada', () => {
    expect(hayCambios(cambiosDelTablero(null, antes))).toBe(false);
    expect(hayCambios(cambiosDelTablero(antes, foto('2026-11-10', [['i9', 'ana']])))).toBe(false);
  });

  it('detecta casos nuevos, movidos, columnas que reciben y contadores que cambian', () => {
    const ahora = foto('2026-11-09', [['i1', 'marta'], ['i2', 'luis'], ['i3', 'ana'], ['i4', 'luis']]);
    const c = cambiosDelTablero(antes, ahora);
    expect([...c.nuevos]).toEqual(['i4']);
    expect([...c.movidos].sort()).toEqual(['i1', 'i3']);
    expect([...c.receptores].sort()).toEqual(['ana', 'luis', 'marta']);
    // Ana: 1 → 1 (perdió i1, recibió i3): su contador no cambia
    expect([...c.conteosCambiados].sort()).toEqual(['luis', 'marta']);
  });

  it('un caso que se cierra solo cambia el contador', () => {
    const c = cambiosDelTablero(antes, foto('2026-11-09', [['i2', 'luis'], ['i3', null]]));
    expect(c.nuevos.size + c.movidos.size + c.receptores.size).toBe(0);
    expect([...c.conteosCambiados]).toEqual(['ana']);
  });

  it('sin cambios (re-dibujo por la hora) no hay nada que animar', () => {
    expect(hayCambios(cambiosDelTablero(antes, foto('2026-11-09', [['i3', null], ['i2', 'luis'], ['i1', 'ana']])))).toBe(false);
  });
});
