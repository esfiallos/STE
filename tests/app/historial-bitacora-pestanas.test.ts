// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const foto = [
  {
    id: 't1', nombre: 'Ana Pérez', turno: 'turnoA', horarioInicio: null, horarioFin: null, almuerzoInicio: '12:00', almuerzoFin: '12:30',
    incidentes: [{ id: 'x', codigo: 'INC500', nota: 'Fibra cortada', tecnicoId: 't1', creadoEn: '' }]
  },
  { id: 't2', nombre: 'Marta Soto', turno: 'comodin', horarioInicio: '08:00', horarioFin: '18:00', almuerzoInicio: null, almuerzoFin: null, incidentes: [] }
];

describe('historial: foto de un día', () => {
  it('se dibuja en solo lectura con las mismas vistas del tablero', async () => {
    await iniciarApp();
    const { renderizarSnapshot } = await import('../../src/scripts/history/snapshotBoard');
    const contenedor = document.createElement('div');
    document.body.append(contenedor);

    renderizarSnapshot(contenedor, foto as never);

    expect(contenedor.querySelectorAll('.noc-accordion-card')).toHaveLength(3);
    expect(contenedor.querySelectorAll('[data-action="asignar"]')).toHaveLength(0);
    expect(contenedor.querySelectorAll('.status-chip')).toHaveLength(0);
    expect(contenedor.querySelectorAll('form')).toHaveLength(0);
    expect((contenedor.querySelector('.incident-item-card') as HTMLElement).draggable).toBe(false);
    expect(contenedor.querySelector('.inc-note')!.classList.contains('hidden')).toBe(false);
    expect(contenedor.querySelectorAll('[data-tecnico-id="t2"]')).toHaveLength(2); // el comodín, en A y B
    expect(contenedor.querySelectorAll('.lunch-item.is-active')).toHaveLength(0);
  });
});

describe('bitácora', () => {
  it('muestra quién hizo qué, con la acción en español', async () => {
    await iniciarApp();
    const { crearTablaBitacora } = await import('../../src/scripts/audit/auditTable');

    const tabla = crearTablaBitacora(
      [{ id: '1', creadoEn: '2026-11-09T16:05:00Z', usuario: 'ana@x.com', accion: 'incidente_reasignado', codigo: 'INC1', tecnico: 'Marta', detalle: 'De Ana a Marta' }],
      'vacío'
    );

    expect(tabla.textContent).toContain('Incidente reasignado');
    expect(tabla.textContent).toContain('ana@x.com');
    expect(crearTablaBitacora([], 'Nada aquí').textContent).toBe('Nada aquí');
  });
});

describe('pestañas', () => {
  it('la vista activa sale de la dirección (#historial) y cambia al pulsar una pestaña', async () => {
    await iniciarApp();
    const { iniciarPestanas } = await import('../../src/scripts/features/tabs');
    const abiertas: string[] = [];

    window.location.hash = 'historial';
    await esperar();
    iniciarPestanas({ tablero: () => abiertas.push('t'), historial: () => abiertas.push('h'), bitacora: () => abiertas.push('b') });

    expect(document.querySelector('[data-vista="historial"]')!.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-vista="tablero"]')!.classList.contains('hidden')).toBe(true);

    document.querySelector<HTMLElement>('[data-tab="bitacora"]')!.click();
    await esperar();

    expect(document.querySelector('[data-vista="bitacora"]')!.classList.contains('hidden')).toBe(false);
    expect(abiertas).toEqual(['h', 'b']);
    window.location.hash = '';
  });
});
