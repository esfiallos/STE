import { describe, expect, it } from 'vitest';
import { describirNoDisponibilidad, estadoDelTecnico } from '../../src/domain/availability';
import { horarioDelTecnico, tecnicosDelTurno, turnosDelTecnico } from '../../src/domain/shifts';
import type { Tecnico } from '../../src/types/noc';

const tecnico = (extra: Partial<Tecnico>): Tecnico => ({
  id: 't', nombre: 'Ana', turno: 'turnoA', horarioInicio: null, horarioFin: null, almuerzoInicio: null, almuerzoFin: null, ...extra
});
const a = (h: number, m = 0) => new Date(2026, 10, 9, h, m);

describe('turnos y comodín', () => {
  it('un técnico fijo usa el horario de su turno', () => {
    expect(horarioDelTecnico(tecnico({ turno: 'turnoB' }))).toEqual({ inicio: '14:00', fin: '22:00' });
  });

  it('un comodín usa su horario propio y aparece en todos los turnos que toca', () => {
    const comodin = tecnico({ turno: 'comodin', horarioInicio: '08:00', horarioFin: '18:00' });
    expect(horarioDelTecnico(comodin)).toEqual({ inicio: '08:00', fin: '18:00' });
    expect(turnosDelTecnico(comodin)).toEqual(['turnoA', 'turnoB']);
  });

  it('un comodín sin horario no aparece en ningún turno', () => {
    expect(turnosDelTecnico(tecnico({ turno: 'comodin' }))).toEqual([]);
  });

  it('filtra los técnicos de un turno incluyendo a los comodín', () => {
    const lista = [tecnico({ id: 'a' }), tecnico({ id: 'c', turno: 'turnoC' }), tecnico({ id: 'm', turno: 'comodin', horarioInicio: '08:00', horarioFin: '18:00' })];
    expect(tecnicosDelTurno(lista, 'turnoA').map((t) => t.id)).toEqual(['a', 'm']);
    expect(tecnicosDelTurno(lista, 'turnoC').map((t) => t.id)).toEqual(['c']);
  });
});

describe('disponibilidad', () => {
  const ana = tecnico({ almuerzoInicio: '12:00', almuerzoFin: '12:30' });

  it('solo está disponible en su horario y fuera del almuerzo', () => {
    expect(estadoDelTecnico(ana, a(10))).toBe('disponible');
    expect(estadoDelTecnico(ana, a(12, 10))).toBe('almuerzo');
    expect(estadoDelTecnico(ana, a(12, 30))).toBe('disponible');
    expect(estadoDelTecnico(ana, a(15))).toBe('fuera-de-horario');
  });

  it('un turno nocturno está disponible después de medianoche', () => {
    expect(estadoDelTecnico(tecnico({ turno: 'turnoC' }), a(2))).toBe('disponible');
  });

  it('explica por qué no está disponible', () => {
    expect(describirNoDisponibilidad(ana, 'almuerzo')).toBe('Ana está en su almuerzo hasta las 12:30.');
    expect(describirNoDisponibilidad(ana, 'fuera-de-horario')).toBe('Ana está fuera de su horario (06:00 - 14:00).');
  });
});
