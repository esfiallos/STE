import { describe, expect, it } from 'vitest';
import { claveDeRonda, ordenarRonda, siguienteEnRonda, turnoEnCurso } from '../../src/domain/round';

const c = (id: string, nombre: string) => ({ id, nombre });

describe('ronda de asignación', () => {
  const candidatos = [c('3', 'Carla Díaz'), c('1', 'ana Pérez'), c('4', 'Beto Ruiz'), c('2', 'Álvaro Gómez')];

  it('ordena por nombre sin acentos ni mayúsculas', () => {
    expect(claveDeRonda('  Álvaro   GÓMEZ ')).toBe('alvaro gomez');
    expect(ordenarRonda(candidatos).map((x) => x.nombre)).toEqual(['Álvaro Gómez', 'ana Pérez', 'Beto Ruiz', 'Carla Díaz']);
  });

  it('elige al siguiente después del último y vuelve al primero al final', () => {
    expect(siguienteEnRonda(candidatos, null)!.nombre).toBe('Álvaro Gómez');
    expect(siguienteEnRonda(candidatos, 'Ana Perez')!.nombre).toBe('Beto Ruiz');
    expect(siguienteEnRonda(candidatos, 'Carla Díaz')!.nombre).toBe('Álvaro Gómez');
  });

  it('si el último ya no está disponible, sigue con quien va después de él en el orden', () => {
    const sinBeto = candidatos.filter((x) => x.nombre !== 'Beto Ruiz');
    expect(siguienteEnRonda(sinBeto, 'Beto Ruiz')!.nombre).toBe('Carla Díaz');
    expect(siguienteEnRonda([], 'Beto Ruiz')).toBeNull();
  });

  it('el puntero es por turno: A 06–14, B 14–22, C 22–06', () => {
    const a = (h: number, m = 0) => turnoEnCurso(new Date(2026, 10, 9, h, m));
    expect([a(6), a(13, 59), a(14), a(21, 59), a(22), a(3), a(5, 59)]).toEqual(['turnoA', 'turnoA', 'turnoB', 'turnoB', 'turnoC', 'turnoC', 'turnoC']);
  });
});
