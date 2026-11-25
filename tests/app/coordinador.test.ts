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

function datosDeCoordinacion() {
  const datos = datosBase();
  datos.casos = [
    { id: 'c1', codigo: 'INC100', nota: 'ACME · enlace 4410', cliente: 'ACME', area: 'CORE IP', estado: 'en_curso', ultima_actualizacion_en: '2026-11-09T13:00:00Z', ultima_actualizacion_por: 'ana@noc.test', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:00:00Z', _fecha: HOY },
    { id: 'c2', codigo: 'INC200', nota: '<b>BETA</b>', estado: 'pausado', tecnico_actual_id: 'luis', creado_en: '2026-11-09T12:30:00Z', _fecha: HOY },
    { id: 'c3', codigo: 'INC300', nota: 'Viejo', estado: 'cerrado', tecnico_actual_id: 'ana', creado_en: '2026-11-01T12:30:00Z', cerrado_en: '2026-11-02T10:00:00Z', _fecha: '2026-11-01' }
  ];
  datos.caso_responsables = [
    { id: 'r1', caso_id: 'c1', tecnico_nombre: 'Ana Pérez', fecha_operativa: HOY, origen: 'dispatch', desde: '2026-11-09T12:00:00Z', hasta: null, asignado_por: 'dispatch@noc.test' }
  ];
  datos.traspasos = [{ id: 't1', de_tecnico_id: 'luis', fecha_operativa: '2026-11-08', estado: 'enviado', turno_origen: 'turnoB', enviado_en: '2026-11-09T04:00:00Z' }];
  datos.traspaso_items = [
    { id: 'i1', traspaso_id: 't1', caso_id: 'c1', para_tecnico_id: 'ana', estado: 'en_curso', etiqueta: 'VM', descripcion: 'Ojo con el proveedor', fecha_destino: HOY }
  ];
  datos.alertas_coordinacion = [
    { id: 'a1', tipo: 'sin_actualizacion', caso_id: 'c2', tecnico_id: 'luis', tecnico_nombre: 'Luis Mora', nivel: 2, referencia: '2026-11-09T12:00:00Z', detalle: 'INC200', leida: false, creado_en: '2026-11-09T14:00:00Z' },
    { id: 'a2', tipo: 'sin_actualizacion', caso_id: 'c2', tecnico_id: 'luis', tecnico_nombre: 'Luis Mora', nivel: 4, referencia: '2026-11-09T12:00:00Z', detalle: 'INC200', leida: false, creado_en: '2026-11-09T16:00:00Z' },
    { id: 'a3', tipo: 'sin_actualizacion', caso_id: 'c1', tecnico_id: 'ana', tecnico_nombre: 'Ana Pérez', nivel: 2, referencia: '2026-11-09T12:00:00Z', detalle: 'INC100', leida: true, creado_en: '2026-11-09T14:00:00Z' }
  ];
  return datos;
}

async function abrirComoCoordinador() {
  const app = await iniciarApp(datosDeCoordinacion(), { rol: 'coordinador' });
  vi.doMock('../../src/services/coordinacionRepo', async (original) => ({
    ...(await original<typeof import('../../src/services/coordinacionRepo')>()),
    suscribirAlertas: () => () => undefined
  }));
  const panel = await import('../../src/scripts/coordination/coordinatorPanel');
  const campana = await import('../../src/scripts/coordination/alertsBell');
  const buscador = await import('../../src/scripts/caseSearch/caseSearchView');
  const abrirCaso = vi.fn((alerta: { detalle: string | null }) => void buscador.buscarCaso(alerta.detalle ?? ''));
  panel.iniciarPanelDeCoordinacion();
  campana.iniciarCampanaDeAlertas(abrirCaso);
  buscador.iniciarBuscadorDeCasos();
  await panel.cargarPanel();
  await esperar(60);
  return { ...app, panel, buscador, abrirCaso };
}

describe('coordinador', () => {
  it('el panel muestra los tickets del día por estado', async () => {
    const app = await abrirComoCoordinador();
    const valor = (stat: string) => app.q(`#coordStats [data-stat="${stat}"]`).textContent;
    expect(valor('total')).toBe('2');
    expect(valor('en_curso')).toBe('1');
    expect(valor('pausado')).toBe('1');
    expect(valor('cerrado')).toBe('0');
    expect(app.q<HTMLElement>('[data-barra="pausado"]').style.width).toBe('50%');
  });

  it('las alertas se agrupan por caso; al abrir una se atienden las del caso y se busca el caso', async () => {
    const app = await abrirComoCoordinador();
    const alertas = app.qa('#coordAlerts [data-alerta-id]');
    expect(alertas.map((a) => a.textContent)).toEqual([expect.stringContaining('INC200: 4 h sin actualización de Luis Mora')]);
    expect(app.q('#alertsCount').textContent).toBe('1');
    expect(app.q('#panelBadge').textContent).toBe('1');

    app.click(alertas[0]!);
    await esperar(80);
    expect(app.abrirCaso).toHaveBeenCalledTimes(1);
    expect(app.db.alertas_coordinacion!.filter((a) => !a.leida)).toHaveLength(0);
    expect(app.q('#alertsCount').classList.contains('hidden')).toBe(true);
    expect(app.qa('#caseSearchResults [data-caso-id]').map((t) => t.dataset.casoId)).toEqual(['c2']);
  });

  it('busca en todos los casos (también los cerrados) y muestra la ficha con responsables y traspasos', async () => {
    const app = await abrirComoCoordinador();
    await app.buscador.buscarCaso('ana');
    await esperar(80);

    const tarjetas = app.qa('#caseSearchResults [data-caso-id]');
    expect(tarjetas.map((t) => t.dataset.casoId)).toEqual(['c1', 'c3']);
    const inc100 = tarjetas[0]!;
    expect(inc100.querySelector('[data-ref="empresa"]')!.textContent).toBe('ACME');
    expect(inc100.querySelector('[data-ref="area"]')!.textContent).toBe('CORE IP');
    expect(inc100.querySelector('[data-ref="actualizacion"]')!.textContent).toContain('ana@noc.test');
    expect(tarjetas[1]!.querySelector('[data-ref="responsable"]')!.textContent).toBe('Ana Pérez (cerrado)');

    app.click(inc100.querySelector('[data-action="ver-ficha"]')!);
    await esperar(80);
    expect(inc100.querySelector('[data-ref="responsables"]')!.textContent).toContain('Ana Pérez · Asignado por dispatch');
    const traspaso = inc100.querySelector('[data-ref="traspasos"]')!.textContent!;
    expect(traspaso).toContain('Luis Mora → Ana Pérez');
    expect(traspaso).toContain('Descripción: Ojo con el proveedor');

    // El texto del usuario nunca se interpreta como HTML
    await app.buscador.buscarCaso('beta');
    await esperar(80);
    expect(app.q('#caseSearchResults [data-ref="nota"]').textContent).toBe('<b>BETA</b>');
    expect(app.q('#caseSearchResults b')).toBeNull();
  });

  it('el coordinador ve el tablero en solo lectura y las pestañas de supervisión', async () => {
    const app = await abrirComoCoordinador();
    expect(document.body.classList.contains('solo-lectura')).toBe(true);
    expect(document.body.classList.contains('rol-coordinador')).toBe(true);
    expect(app.q('[data-tab="panel"]').hasAttribute('data-coordinador-only')).toBe(true);
    expect(app.q('[data-tab="busqueda"]').hasAttribute('data-busqueda')).toBe(true);
  });
});
