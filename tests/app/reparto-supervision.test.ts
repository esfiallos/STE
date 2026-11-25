// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase, HOY } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const MANANA = '2026-11-10';

/** Pedro no trabaja hoy y dejó dos casos; Ana (A), Luis (B) y Marta (comodín) trabajan hoy; Ana también mañana. */
function datos() {
  const d = datosBase();
  d.tecnicos.push({ id: 'pedro', nombre: 'Pedro Gil', activo: true });
  d.jornadas.push({ id: 'j-ana-m', fecha_operativa: MANANA, tecnico_id: 'ana', turno: 'turnoA', horario_inicio: null, horario_fin: null, almuerzo_inicio: null, almuerzo_fin: null });
  d.casos.push(
    { id: 'p1', codigo: 'INC21', nota: null, cliente: 'ACME', estado: 'en_curso', tecnico_actual_id: 'pedro', creado_en: '2026-11-08T15:00:00Z', _fecha: '2026-11-08' },
    { id: 'p2', codigo: 'SCTASK22', nota: null, estado: 'pausado', tecnico_actual_id: 'pedro', creado_en: '2026-11-08T16:00:00Z', _fecha: '2026-11-08' }
  );
  return d;
}

const opciones = (app: Awaited<ReturnType<typeof iniciarApp>>, id: string) => [...app.q<HTMLSelectElement>(id).options].map((o) => o.textContent);

describe('repartir casos "por reasignar" (D37)', () => {
  it('el dispatch reparte los casos de quien no está entre un turno: pasan al seguimiento de quien recibe', async () => {
    const app = await iniciarApp(datos());
    app.click(app.q('[data-action="repartir-por-reasignar"]'));
    await esperar(80);

    expect(app.q('#modalDistribute').classList.contains('hidden')).toBe(false);
    expect(app.qa('#distributeCases input').map((c) => (c as HTMLInputElement).checked)).toEqual([true, true]);
    // A las 10:00: hoy A (en curso), comodín y B; mañana A
    expect(opciones(app, '#distributeShift')).toEqual([
      'Turno A · hoy (1)',
      'Comodín 07:00–17:00 · hoy (1)',
      'Turno B · hoy (1)',
      'Turno A · mañana (1)'
    ]);

    const turno = app.q<HTMLSelectElement>('#distributeShift');
    turno.value = `${HOY}|Turno B`;
    turno.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.q('#distributePreview').textContent).toBe('Luis Mora (2): INC21, SCTASK22');
    expect(app.q('#distributeSubmit').textContent).toBe('Entregar 2 caso(s)');

    app.click(app.q('#distributeSubmit'));
    await esperar(150);
    const rpc = app.escrituras.find((e) => e.startsWith('RPC entregar_casos'))!;
    expect(JSON.parse(rpc.slice('RPC entregar_casos '.length))).toEqual({
      p_entregas: [
        { caso: 'p1', tecnico: 'luis', fecha: HOY },
        { caso: 'p2', tecnico: 'luis', fecha: HOY }
      ]
    });
    expect(app.q('#modalDistribute').classList.contains('hidden')).toBe(true);
    // Ya son de Luis (como traspaso): salen de "por reasignar" y no entran al tablero del día
    expect(app.qa('.reassign-strip')).toHaveLength(0);
    expect(app.tarjeta('turnoB', 'luis').querySelectorAll('.incident-item-card')).toHaveLength(0);
    expect(app.qa('.toast').some((t) => t.textContent!.includes('2 caso(s) entregado(s)'))).toBe(true);
  });

  it('se puede dejar fuera un caso o a una persona; el reparto es parejo', async () => {
    const d = datos();
    d.tecnicos.push({ id: 'sofia', nombre: 'Sofía Ruiz', activo: true });
    d.jornadas.push({ id: 'j-sofia', fecha_operativa: MANANA, tecnico_id: 'sofia', turno: 'turnoA', horario_inicio: null, horario_fin: null, almuerzo_inicio: null, almuerzo_fin: null });
    const app = await iniciarApp(d);
    app.click(app.q('[data-action="repartir-por-reasignar"]'));
    await esperar(80);

    const turno = app.q<HTMLSelectElement>('#distributeShift');
    turno.value = `${MANANA}|Turno A`;
    turno.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.qa('#distributeTechs label').map((l) => l.textContent)).toEqual(['Ana Pérez', 'Sofía Ruiz']);
    expect(app.qa('#distributePreview li').map((li) => li.textContent)).toEqual(['Ana Pérez (1): INC21', 'Sofía Ruiz (1): SCTASK22']);

    const ana = app.q<HTMLInputElement>('#distributeTechs [data-tecnico="ana"]');
    ana.checked = false;
    ana.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.q('#distributePreview').textContent).toBe('Sofía Ruiz (2): INC21, SCTASK22');

    const caso = app.q<HTMLInputElement>('#distributeCases [data-caso="p2"]');
    caso.checked = false;
    caso.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.q('#distributeSubmit').textContent).toBe('Entregar 1 caso(s)');

    app.click(app.q('#distributeToggleAll'));
    expect(app.q('#distributeSubmit').textContent).toBe('Entregar 2 caso(s)');
  });

  it('a las 15:00 el turno A de hoy ya terminó: no se ofrece', async () => {
    fijarHora(15);
    const app = await iniciarApp(datos());
    app.click(app.q('[data-action="repartir-por-reasignar"]'));
    await esperar(80);
    expect(opciones(app, '#distributeShift')).toEqual(['Comodín 07:00–17:00 · hoy (1)', 'Turno B · hoy (1)', 'Turno A · mañana (1)']);
  });

  it('coordinación también ve "por reasignar" y reparte (sin arrastrar)', async () => {
    const app = await iniciarApp(datos(), { rol: 'coordinador' });
    const franja = app.q<HTMLElement>('.reassign-strip');
    expect(franja.textContent).toContain('Por reasignar (2)');
    expect(franja.querySelectorAll('.incident-item-card[draggable="true"]')).toHaveLength(0);
    app.click(app.q('[data-action="repartir-por-reasignar"]'));
    await esperar(80);
    expect(app.q('#modalDistribute').classList.contains('hidden')).toBe(false);
  });

  it('el técnico no ve "por reasignar"', async () => {
    const app = await iniciarApp(datos(), { rol: 'tecnico', tecnicoId: 'ana' });
    expect(app.qa('.reassign-strip')).toHaveLength(0);
  });
});

describe('Buscar casos: al vaciar el campo vuelve al estado inicial', () => {
  it('quita los resultados y el mensaje', async () => {
    const app = await iniciarApp(datos());
    (await import('../../src/scripts/caseSearch/caseSearchView')).iniciarBuscadorDeCasos();
    const campo = app.q<HTMLInputElement>('#caseSearchInput');
    campo.value = 'INC2';
    app.q<HTMLFormElement>('#caseSearchForm').requestSubmit();
    await esperar(80);
    expect(app.qa('#caseSearchResults [data-caso-id]').length).toBeGreaterThan(0);

    campo.value = '';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.qa('#caseSearchResults [data-caso-id]')).toHaveLength(0);
    expect(app.q('#caseSearchStatus').classList.contains('hidden')).toBe(true);

    campo.value = 'nada-que-exista';
    app.q<HTMLFormElement>('#caseSearchForm').requestSubmit();
    await esperar(80);
    expect(app.q('#caseSearchStatus').textContent).toContain('No hay casos');
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(campo.value).toBe('');
    expect(app.q('#caseSearchStatus').classList.contains('hidden')).toBe(true);
  });
});
