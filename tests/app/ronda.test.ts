// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('asignar a la ronda (modal Nuevo caso)', () => {
  it('muestra quién sigue, asigna por ronda en orden alfabético y avanza', async () => {
    const app = await iniciarApp();
    const escribir = (id: string, valor: string) => {
      app.q<HTMLInputElement>(`#${id}`).value = valor;
    };

    app.abrirModalAsignar();
    await esperar();
    // Disponibles a las 10:00: Ana (A) y Marta (comodín 07–17); Luis (B) está fuera de horario
    expect(app.q('#roundHint').textContent).toBe('Siguiente en la ronda: Ana Pérez');

    escribir('inputIncNumber', ' inc50 ');
    escribir('inputIncNote', 'ACME · enlace 4410');
    app.click(app.q('#btnAssignRound'));
    await esperar(80);

    expect(app.db.casos!.find((c) => c.codigo === 'INC50')).toMatchObject({ tecnico_actual_id: 'ana', nota: 'ACME · enlace 4410' });
    expect(app.escrituras.some((e) => e.startsWith('RPC asignar_a_ronda'))).toBe(true);

    // Después de Ana sigue Marta (Luis no está disponible a esta hora)
    app.abrirModalAsignar();
    await esperar();
    expect(app.q('#roundHint').textContent).toBe('Siguiente en la ronda: Marta Soto');
  });

  it('no asigna por ronda un código que ya está en el tablero ni sin número', async () => {
    const app = await iniciarApp();
    app.abrirModalAsignar();
    app.click(app.q('#btnAssignRound'));
    expect(app.q('#incidentError').textContent).toBe('Indica el número de incidente.');

    app.q<HTMLInputElement>('#inputIncNumber').value = 'inc1';
    app.click(app.q('#btnAssignRound'));
    await esperar();
    expect(app.q('#incidentError').textContent).toBe('INC1 ya está asignado a Ana Pérez.');
    expect(app.escrituras.some((e) => e.startsWith('RPC asignar_a_ronda'))).toBe(false);
  });

  it('muestra el motivo de la base cuando el código ya existía en el historial', async () => {
    const datos = datosBase();
    datos.casos.push({ id: 'viejo', codigo: 'INC77', nota: null, estado: 'cerrado', tecnico_actual_id: 'luis', creado_en: '2026-11-01T10:00:00Z', _fecha: '2026-11-01' });
    const app = await iniciarApp(datos);
    app.abrirModalAsignar();
    app.q<HTMLInputElement>('#inputIncNumber').value = 'INC77';
    app.click(app.q('#btnAssignRound'));
    await esperar(80);
    expect(app.q('#incidentError').textContent).toBe('El caso INC77 ya existe: asígnalo a un técnico concreto.');
  });

  it('sin técnicos disponibles el botón de la ronda queda deshabilitado', async () => {
    fijarHora(3); // turno C: nadie de los datos base trabaja a esa hora
    const app = await iniciarApp();
    app.abrirModalAsignar();
    expect(app.q<HTMLButtonElement>('#btnAssignRound').disabled).toBe(true);
  });
});
