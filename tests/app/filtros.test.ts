// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase, HOY } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10);
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Ana y Marta (turno A / comodín) con casos de los tres tipos, áreas y estados distintos. */
function datosConTipos() {
  const datos = datosBase();
  datos.casos = [
    { id: 'c1', codigo: 'INC1', nota: null, area: 'CPE', estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:00:00Z', _fecha: HOY },
    { id: 'c2', codigo: 'SCTASK2', nota: null, area: 'TX', estado: 'pausado', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:10:00Z', _fecha: HOY },
    { id: 'c3', codigo: '#SR3', nota: null, area: 'CPE', estado: 'en_curso', tecnico_actual_id: 'marta', creado_en: '2026-11-09T12:20:00Z', _fecha: HOY },
    { id: 'c4', codigo: '#INC4', nota: null, estado: 'resuelto', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:30:00Z', _fecha: HOY }
  ];
  return datos;
}

const chip = (raiz: string, texto: string) =>
  [...document.querySelectorAll<HTMLElement>(`${raiz} .case-chip`)].find((c) => c.firstElementChild!.textContent === texto)!;
const elegir = (raiz: string, filtro: string, valor: string) => {
  const select = document.querySelector<HTMLSelectElement>(`${raiz} select[data-filtro="${filtro}"]`)!;
  select.value = valor;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('filtros del tablero', () => {
  it('chips de tipo con contador; filtran las tarjetas sin tocar las columnas y se pueden limpiar', async () => {
    const app = await iniciarApp(datosConTipos());
    // El comodín aparece en dos turnos: se cuentan los códigos distintos
    const codigos = () => [...new Set(app.qa('.incident-item-card .inc-code').map((c) => c.textContent))].sort();

    expect(app.qa('#boardFilters .case-chip').map((c) => c.textContent)).toEqual(['Todos4', 'FRESH2', 'Tarea1', 'Incidente1']);
    expect(app.tarjeta('turnoA', 'ana').querySelector('.case-type')!.textContent).toBe('Incidente');

    app.click(chip('#boardFilters', 'FRESH'));
    await esperar();
    expect(codigos()).toEqual(['#INC4', '#SR3']);
    expect(app.qa('.tech-column-card')).toHaveLength(4); // las columnas siguen
    expect(app.q('#boardFilters .case-filters__summary').textContent).toBe('Mostrando 2 de 4');

    elegir('#boardFilters', 'area', 'CPE');
    await esperar();
    expect(codigos()).toEqual(['#SR3']);
    // El contador de cada tipo ya cuenta con el área elegida
    expect(chip('#boardFilters', 'Incidente').textContent).toBe('Incidente1');
    expect(chip('#boardFilters', 'Tarea').textContent).toBe('Tarea0');

    app.click(app.q('#boardFilters .case-filters__clear'));
    await esperar();
    expect(codigos()).toHaveLength(4);
    expect(app.q('#boardFilters .case-filters__clear').classList.contains('hidden')).toBe(true);
  });

  it('se recuerdan en la sesión al volver a abrir', async () => {
    await iniciarApp(datosConTipos());
    elegir('#boardFilters', 'estado', 'pausado');
    await esperar();
    vi.unstubAllGlobals();
    const app = await iniciarApp(datosConTipos());
    expect(app.q<HTMLSelectElement>('#boardFilters select[data-filtro="estado"]').value).toBe('pausado');
    expect(app.qa('.incident-item-card .inc-code').map((c) => c.textContent)).toEqual(['SCTASK2']);
  });
});

describe('filtros de Mi seguimiento', () => {
  it('filtra las filas de cada grupo por tipo y estado', async () => {
    const app = await iniciarApp(datosConTipos(), { rol: 'tecnico', tecnicoId: 'ana' });
    const seguimiento = await import('../../src/scripts/followUp/followUpView');
    seguimiento.iniciarSeguimiento('ana');
    await esperar(80);
    const filas = () => app.qa('#followUpView .followup-row[data-caso-id] .followup-code').map((c) => c.textContent);

    expect(filas()).toEqual(['INC1', 'SCTASK2', '#INC4']);
    app.click(chip('#followUpFilters', 'Tarea'));
    await esperar();
    expect(filas()).toEqual(['SCTASK2']);
    expect(app.q('[data-grupo="nuevos"] [data-ref="conteo"]').textContent).toBe('1');

    app.click(chip('#followUpFilters', 'Tarea')); // volver a pulsarlo lo quita
    elegir('#followUpFilters', 'estado', 'cerrado');
    await esperar();
    expect(filas()).toEqual([]);
    expect(app.q('[data-grupo="nuevos"] .empty-incidents').textContent).toBe('Ningún caso coincide con los filtros.');
  });
});

describe('filtros del panel de coordinación', () => {
  it('las estadísticas filtradas salen del tablero del día; sin filtros, de la base', async () => {
    const app = await iniciarApp(datosConTipos(), { rol: 'coordinador' });
    const panel = await import('../../src/scripts/coordination/coordinatorPanel');
    panel.iniciarPanelDeCoordinacion();
    await panel.cargarPanel();
    const valor = (stat: string) => app.q(`#coordStats [data-stat="${stat}"]`).textContent;
    expect(valor('total')).toBe('4');
    expect(app.escrituras.filter((e) => e.startsWith('RPC estadisticas_del_dia'))).toHaveLength(1);

    elegir('#coordFilters', 'tecnico', 'ana');
    await esperar(80);
    expect(valor('total')).toBe('3');
    expect(valor('pausado')).toBe('1');
    expect(valor('resuelto')).toBe('1');
    app.click(chip('#coordFilters', 'FRESH'));
    await esperar(80);
    expect(valor('total')).toBe('1');
    expect(app.escrituras.filter((e) => e.startsWith('RPC estadisticas_del_dia'))).toHaveLength(1);
  });
});
