import { describe, expect, it } from 'vitest';
import { describirNoDisponibilidad, estadoDelTecnico } from '../../src/domain/availability';
import { abreviaturaDeJornada, opcionDeJornada, OPCIONES_DE_JORNADA, valorDeJornada } from '../../src/domain/planning';
import { horarioDelTecnico, nombreDeJornada, tecnicosDelTurno, tramoDelTurnoC, turnosDelTecnico } from '../../src/domain/shifts';
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

describe('turno C por tramos (C1 22-00, C2 00-06)', () => {
  const c1 = tecnico({ turno: 'turnoC', horarioInicio: '22:00', horarioFin: '00:00' });
  const c2 = tecnico({ turno: 'turnoC', horarioInicio: '00:00', horarioFin: '06:00' });
  const noche = tecnico({ turno: 'turnoC', horarioInicio: '22:00', horarioFin: '06:00' });

  it('cada tramo tiene su horario y sigue en la sección del turno C', () => {
    expect(horarioDelTecnico(c1)).toEqual({ inicio: '22:00', fin: '00:00' });
    expect(horarioDelTecnico(c2)).toEqual({ inicio: '00:00', fin: '06:00' });
    expect(horarioDelTecnico(tecnico({ turno: 'turnoC' }))).toEqual({ inicio: '22:00', fin: '06:00' });
    expect([c1, c2, noche].map((t) => turnosDelTecnico(t))).toEqual([['turnoC'], ['turnoC'], ['turnoC']]);
  });

  it('la disponibilidad respeta el tramo', () => {
    expect([estadoDelTecnico(c1, a(23)), estadoDelTecnico(c1, a(1))]).toEqual(['disponible', 'fuera-de-horario']);
    expect([estadoDelTecnico(c2, a(23)), estadoDelTecnico(c2, a(1))]).toEqual(['fuera-de-horario', 'disponible']);
    expect([estadoDelTecnico(noche, a(23)), estadoDelTecnico(noche, a(1))]).toEqual(['disponible', 'disponible']);
    expect(describirNoDisponibilidad({ ...c1, nombre: 'Luis' }, 'fuera-de-horario')).toBe('Luis está fuera de su horario (22:00 - 00:00).');
  });

  it('nombres: C1, C2 y C1 + C2 (quien hace toda la noche tiene los dos)', () => {
    expect([c1, c2, noche].map(nombreDeJornada)).toEqual(['Turno C1', 'Turno C2', 'Turno C1 + C2']);
    expect(tramoDelTurnoC('23:00', '06:00')).toBeNull();
    expect(nombreDeJornada(tecnico({ turno: 'comodin', horarioInicio: '07:00', horarioFin: '17:00' }))).toBe('Comodín 07:00–17:00');
  });

  it('la planificación ofrece los tres tramos de C (y ya no un C sin horario)', () => {
    const deC = OPCIONES_DE_JORNADA.filter((o) => o.turno === 'turnoC');
    expect(deC.map((o) => [o.etiqueta, o.horarioInicio, o.horarioFin])).toEqual([
      ['Turno C1 (22:00-00:00)', '22:00', '00:00'],
      ['Turno C2 (00:00-06:00)', '00:00', '06:00'],
      ['Turno C1 + C2 (22:00-06:00)', '22:00', '06:00']
    ]);
    expect(opcionDeJornada('turnoC')).toBeUndefined();
    expect(valorDeJornada({ turno: 'turnoC', horarioInicio: '00:00', horarioFin: '06:00' })).toBe('turnoC-00:00-06:00');
    // Una jornada C guardada antes de la migración 14 (sin horario) es toda la noche
    expect(valorDeJornada({ turno: 'turnoC', horarioInicio: null, horarioFin: null })).toBe('turnoC-22:00-06:00');
    expect(abreviaturaDeJornada({ turno: 'turnoC', horarioInicio: '22:00', horarioFin: '00:00' })).toBe('Turno C1');
  });
});
