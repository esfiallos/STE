// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase, type Datos } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10); // lunes 9/11/2026
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Por defecto como coordinación, que es quien planifica (D14). */
async function abrirPlanificacion(datos: Datos = datosBase(), rol: 'coordinador' | 'dispatch' = 'coordinador') {
  const app = await iniciarApp(datos, { rol });
  const { iniciarPlanificacion, cargarPlanificacion } = await import('../../src/scripts/planning/planningView');
  const { cargarSolicitudes } = await import('../../src/scripts/actions/planningRequestActions');
  const { iniciarModalAlmuerzo } = await import('../../src/scripts/modals/lunchModal');
  app.appStore.set({ vista: 'planificacion' });
  iniciarPlanificacion();
  iniciarModalAlmuerzo();
  await cargarSolicitudes();
  await cargarPlanificacion();

  const celda = (tecnico: string, fecha: string) =>
    document.querySelector<HTMLElement>(`#planningGrid [data-tecnico-id="${tecnico}"][data-fecha="${fecha}"]`)!;
  const elegir = async (tecnico: string, fecha: string, valor: string) => {
    const selector = celda(tecnico, fecha).querySelector<HTMLSelectElement>('select')!;
    selector.value = valor;
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(80);
  };
  return { ...app, celda, elegir };
}

describe('planificación semanal (coordinación)', () => {
  it('muestra la semana de lunes a domingo con el turno de cada técnico activo', async () => {
    const datos = datosBase();
    datos.tecnicos.push({ id: 'pedro', nombre: 'Pedro Inactivo', activo: false });
    const app = await abrirPlanificacion(datos);

    expect(app.q('#planningWeekLabel').textContent).toBe('Semana del 09/11 al 15/11');
    expect(app.qa('#planningGrid tbody tr')).toHaveLength(3); // Pedro está inactivo
    expect(app.celda('ana', '2026-11-09').querySelector('select')!.value).toBe('turnoA');
    expect(app.celda('marta', '2026-11-09').querySelector('select')!.value).toBe('comodin-07:00');
    expect(app.celda('ana', '2026-11-10').querySelector('select')!.value).toBe('');
    expect(app.celda('ana', '2026-11-09').classList.contains('is-today')).toBe(true);
    expect(app.celda('ana', '2026-11-09').textContent).toContain('Almuerzo 12:00-12:30');
  });

  it('asignar un turno crea la jornada; el comodín guarda su horario fijo; "Libre" la quita', async () => {
    const app = await abrirPlanificacion();

    await app.elegir('luis', '2026-11-10', 'comodin-08:00');
    expect(app.db.jornadas!.find((j) => j.tecnico_id === 'luis' && j.fecha_operativa === '2026-11-10')).toMatchObject({
      turno: 'comodin',
      horario_inicio: '08:00',
      horario_fin: '18:00'
    });

    await app.elegir('ana', '2026-11-09', 'turnoB');
    const ana = app.db.jornadas!.find((j) => j.tecnico_id === 'ana' && j.fecha_operativa === '2026-11-09');
    expect(ana).toMatchObject({ turno: 'turnoB', horario_inicio: null, almuerzo_inicio: '12:00' }); // conserva el almuerzo
    expect(app.tarjeta('turnoB', 'ana')).toBeTruthy(); // el tablero de hoy se actualiza

    await app.elegir('luis', '2026-11-10', '');
    expect(app.db.jornadas!.some((j) => j.tecnico_id === 'luis' && j.fecha_operativa === '2026-11-10')).toBe(false);
  });

  it('los días pasados no se pueden cambiar', async () => {
    const app = await abrirPlanificacion();
    app.click(app.q('#btnPrevWeek'));
    await esperar(80);

    expect(app.q('#planningWeekLabel').textContent).toBe('Semana del 02/11 al 08/11');
    expect(app.celda('ana', '2026-11-05').querySelector('select')!.disabled).toBe(true);
  });

  it('copia la semana anterior sobre la actual', async () => {
    const datos = datosBase();
    datos.jornadas.push(
      { id: 'p1', fecha_operativa: '2026-11-03', tecnico_id: 'luis', turno: 'turnoC', horario_inicio: null, horario_fin: null, almuerzo_inicio: '02:00', almuerzo_fin: '02:30' },
      { id: 'p2', fecha_operativa: '2026-11-07', tecnico_id: 'ana', turno: 'turnoA', horario_inicio: null, horario_fin: null, almuerzo_inicio: null, almuerzo_fin: null }
    );
    const app = await abrirPlanificacion(datos);

    app.click(app.q('#btnCopyPrevWeek'));
    await esperar(120);

    expect(app.confirmar).toHaveBeenCalledTimes(1);
    expect(app.db.jornadas!.find((j) => j.fecha_operativa === '2026-11-10' && j.tecnico_id === 'luis')).toMatchObject({
      turno: 'turnoC',
      almuerzo_inicio: '02:00'
    });
    expect(app.celda('ana', '2026-11-14').querySelector('select')!.value).toBe('turnoA');
  });

  it('el almuerzo de un día se edita desde la celda', async () => {
    const app = await abrirPlanificacion();
    app.click(app.celda('ana', '2026-11-09').querySelector('.planning-lunch')!);

    expect(app.q('#lunchTechName').textContent).toContain('Ana Pérez · 09/11');
    app.q<HTMLInputElement>('#lunchStart').value = '13:00';
    app.q<HTMLInputElement>('#lunchEnd').value = '13:30';
    app.q<HTMLFormElement>('#formLunch').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await esperar(120);

    expect(app.db.jornadas!.find((j) => j.id === 'j-ana')).toMatchObject({ almuerzo_inicio: '13:00', almuerzo_fin: '13:30' });
    expect(app.celda('ana', '2026-11-09').textContent).toContain('Almuerzo 13:00-13:30');
  });
});

const solicitudFila = (parcial: Record<string, unknown>) => ({
  id: 's1', fecha_operativa: '2026-11-10', motivo: 'Falta Luis', solicitante_nombre: 'Dispatch Uno', estado: 'pendiente', respuesta: null,
  resuelta_por_nombre: null, resuelta_en: null, vence_en: null, respuesta_vista: false, creada_en: '2026-11-09T15:00:00Z', ...parcial
});

describe('planificación con solicitudes (D14)', () => {
  it('para el dispatch es de solo lectura y pide permiso por día con un motivo', async () => {
    const app = await abrirPlanificacion(datosBase(), 'dispatch');
    expect(app.celda('ana', '2026-11-09').querySelector('select')!.disabled).toBe(true);
    expect(app.celda('ana', '2026-11-12').querySelector('select')!.disabled).toBe(true);
    expect(app.celda('ana', '2026-11-09').querySelector<HTMLButtonElement>('.planning-lunch')!.disabled).toBe(true);
    expect(app.q('#btnCopyPrevWeek').hasAttribute('data-coordinador-only')).toBe(true);
    expect(app.qa('#planningRequestDate option').map((o) => o.textContent)).toEqual([
      'Lun 09/11', 'Mar 10/11', 'Mié 11/11', 'Jue 12/11', 'Vie 13/11', 'Sáb 14/11', 'Dom 15/11'
    ]);

    const enviar = async () => {
      app.q<HTMLFormElement>('#planningRequestForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await esperar(80);
    };
    app.q<HTMLSelectElement>('#planningRequestDate').value = '2026-11-10';
    await enviar();
    expect(app.q('#planningRequestError').textContent).toBe('Indica el motivo de la solicitud.');
    expect(app.escrituras.some((e) => e.startsWith('RPC solicitar_edicion_planificacion'))).toBe(false);

    app.q<HTMLInputElement>('#planningRequestReason').value = '  Luis se reportó enfermo ';
    await enviar();
    expect(app.db.solicitudes_planificacion).toHaveLength(1);
    expect(app.db.solicitudes_planificacion![0]).toMatchObject({ fecha_operativa: '2026-11-10', motivo: 'Luis se reportó enfermo', estado: 'pendiente' });
    expect(app.q('#planningRequestError').classList.contains('hidden')).toBe(true);
    expect(app.q<HTMLInputElement>('#planningRequestReason').value).toBe('');
    expect(app.q('#planningGrid thead').textContent).toContain('Solicitud pendiente');
    expect(app.q('#planningRequestList').textContent).toContain('Editar el 10/11 · Luis se reportó enfermo');
    expect(app.celda('ana', '2026-11-10').querySelector('select')!.disabled).toBe(true);
  });

  it('con una aprobación vigente el dispatch edita solo ese día', async () => {
    const datos = {
      ...datosBase(),
      solicitudes_planificacion: [solicitudFila({ estado: 'aprobada', resuelta_por_nombre: 'Coord', resuelta_en: '2026-11-09T15:30:00Z', vence_en: '2026-11-10T12:00:00Z' })]
    };
    const app = await abrirPlanificacion(datos, 'dispatch');
    expect(app.celda('luis', '2026-11-10').querySelector('select')!.disabled).toBe(false);
    expect(app.celda('luis', '2026-11-11').querySelector('select')!.disabled).toBe(true);
    expect(app.celda('ana', '2026-11-09').querySelector('select')!.disabled).toBe(true);
    expect(app.q('#planningGrid thead').textContent).toContain('Editable hasta 06:00');

    await app.elegir('luis', '2026-11-10', 'turnoC-22:00-00:00');
    expect(app.db.jornadas!.find((j) => j.tecnico_id === 'luis' && j.fecha_operativa === '2026-11-10'))
      .toMatchObject({ turno: 'turnoC', horario_inicio: '22:00', horario_fin: '00:00' });
  });

  it('coordinación aprueba o rechaza con una respuesta; el dispatch queda habilitado', async () => {
    const datos = {
      ...datosBase(),
      solicitudes_planificacion: [solicitudFila({}), solicitudFila({ id: 's2', fecha_operativa: '2026-11-12', motivo: 'Cambio', creada_en: '2026-11-09T15:10:00Z' })]
    };
    const app = await abrirPlanificacion(datos);
    expect(app.qa('#planningPendingList [data-solicitud-id]')).toHaveLength(2);
    expect(app.q('#planningPendingList').textContent).toContain('Dispatch Uno pide editar la planificación del 10/11: Falta Luis');

    const item = app.q<HTMLElement>('#planningPendingList [data-solicitud-id="s1"]');
    item.querySelector<HTMLInputElement>('input')!.value = 'Adelante';
    app.click(item.querySelector('[data-action="aprobar-solicitud"]')!);
    await esperar(80);
    expect(app.db.solicitudes_planificacion![0]).toMatchObject({ estado: 'aprobada', respuesta: 'Adelante' });

    app.click(app.q('#planningPendingList [data-solicitud-id="s2"] [data-action="rechazar-solicitud"]'));
    await esperar(80);
    expect(app.db.solicitudes_planificacion![1]).toMatchObject({ estado: 'rechazada' });
    expect(app.q('#planningPendingList').textContent).toBe('No hay solicitudes por responder.');
    expect(app.q('#planningGrid thead').textContent).toContain('Dispatch habilitado');
    expect(app.q('#planningRequestList').textContent).toContain('Aprobada por Prueba: Adelante');
  });

  it('la campana del dispatch muestra la respuesta, la marca vista y abre ese día', async () => {
    const datos = {
      ...datosBase(),
      solicitudes_planificacion: [
        solicitudFila({ fecha_operativa: '2026-11-17', estado: 'rechazada', respuesta: 'Hoy no', resuelta_por_nombre: 'Coord', resuelta_en: '2026-11-09T15:30:00Z' })
      ]
    };
    const app = await abrirPlanificacion(datos, 'dispatch');
    const { iniciarCampanaDeSolicitudes } = await import('../../src/scripts/planning/requestsBell');
    const abiertos: string[] = [];
    iniciarCampanaDeSolicitudes((fecha) => abiertos.push(fecha));

    expect(app.q('#requestsCount').textContent).toBe('1');
    expect(app.q('#requestsList').textContent).toContain('Coord rechazó editar el 17/11: Hoy no');
    app.click(app.q('#requestsList [data-solicitud-id]'));
    await esperar(80);
    expect(abiertos).toEqual(['2026-11-17']);
    expect(app.db.solicitudes_planificacion![0]!.respuesta_vista).toBe(true);
    expect(app.q('#requestsCount').classList.contains('hidden')).toBe(true);
  });

  it('la campana de coordinación suma las solicitudes por responder', async () => {
    const datos = { ...datosBase(), solicitudes_planificacion: [solicitudFila({})] };
    const app = await abrirPlanificacion(datos);
    const { iniciarCampanaDeAlertas } = await import('../../src/scripts/coordination/alertsBell');
    const abiertas: string[] = [];
    iniciarCampanaDeAlertas(() => undefined, (solicitud) => abiertas.push(solicitud.fecha));
    await esperar(80);
    expect(app.q('#alertsCount').textContent).toBe('1');
    app.click(app.q('#alertsList [data-solicitud-id]'));
    expect(abiertas).toEqual(['2026-11-10']);
  });
});
