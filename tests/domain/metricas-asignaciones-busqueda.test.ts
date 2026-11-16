import { describe, expect, it } from 'vitest';
import { buscarIncidentePorCodigo, normalizarCodigo, unirTecnicosConIncidentes } from '../../src/domain/assignments';
import { calcularMetricas } from '../../src/domain/metrics';
import { incidenteCoincide, tecnicoCoincide } from '../../src/domain/search';
import { obtenerIniciales } from '../../src/domain/technicians';
import type { Incidente, Tecnico } from '../../src/types/noc';

const base = { horarioInicio: null, horarioFin: null, almuerzoInicio: null, almuerzoFin: null };
const tecnicos: Tecnico[] = [
  { id: 'ana', nombre: 'Ana Pérez', turno: 'turnoA', ...base, almuerzoInicio: '12:00', almuerzoFin: '12:30' },
  { id: 'luis', nombre: 'Luis Mora', turno: 'turnoB', ...base },
  { id: 'marta', nombre: 'Marta Soto', turno: 'comodin', ...base, horarioInicio: '07:00', horarioFin: '17:00' }
];
const incidentes: Incidente[] = [
  { id: 'i1', codigo: 'INC1', nota: 'Fibra cortada', tecnicoId: 'ana', creadoEn: '' },
  { id: 'i2', codigo: 'INC2', nota: null, tecnicoId: 'ana', creadoEn: '' }
];

describe('asignaciones', () => {
  it('normaliza el código igual que la base de datos', () => {
    expect(normalizarCodigo('  inc009842 ')).toBe('INC009842');
  });

  it('encuentra un incidente por código sin importar mayúsculas ni espacios', () => {
    expect(buscarIncidentePorCodigo(incidentes, ' inc2')?.id).toBe('i2');
    expect(buscarIncidentePorCodigo(incidentes, 'INC9')).toBeUndefined();
  });

  it('une técnicos con sus incidentes', () => {
    const unidos = unirTecnicosConIncidentes(tecnicos, incidentes);
    expect(unidos.map((t) => t.incidentes.length)).toEqual([2, 0, 0]);
  });
});

describe('métricas', () => {
  it('a las 12:10 hay 2 técnicos en horario (Ana y la comodín) y 1 en almuerzo', () => {
    const m = calcularMetricas(unirTecnicosConIncidentes(tecnicos, incidentes), new Date(2026, 10, 9, 12, 10));
    expect(m).toEqual({ casosActivos: 2, tecnicosEnTurno: 2, almuerzosActivos: 1 });
  });

  it('a las 15:00 están Luis y la comodín', () => {
    const m = calcularMetricas(unirTecnicosConIncidentes(tecnicos, incidentes), new Date(2026, 10, 9, 15, 0));
    expect(m.tecnicosEnTurno).toBe(2);
    expect(m.almuerzosActivos).toBe(0);
  });
});

describe('búsqueda', () => {
  const [ana, luis] = unirTecnicosConIncidentes(tecnicos, incidentes);

  it('coincide por código o comentario, sin distinguir mayúsculas', () => {
    expect(incidenteCoincide(incidentes[0]!, 'fibra')).toBe(true);
    expect(incidenteCoincide(incidentes[0]!, 'inc1')).toBe(true);
    expect(incidenteCoincide(incidentes[1]!, 'fibra')).toBe(false);
    expect(incidenteCoincide(incidentes[0]!, '')).toBe(false);
  });

  it('un técnico coincide por nombre o por alguno de sus incidentes', () => {
    expect(tecnicoCoincide(ana!, 'pérez')).toBe(true);
    expect(tecnicoCoincide(ana!, 'inc2')).toBe(true);
    expect(tecnicoCoincide(luis!, 'inc2')).toBe(false);
    expect(tecnicoCoincide(luis!, '')).toBe(true);
  });

  it('obtiene iniciales', () => {
    expect(obtenerIniciales('Ana Pérez')).toBe('AP');
    expect(obtenerIniciales('Luis')).toBe('LU');
  });
});
