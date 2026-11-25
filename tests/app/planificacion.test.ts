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

/** Por defecto como coordinación (planifica sin motivo); el dispatch da el motivo por día (D38). */
async function abrirPlanificacion(datos: Datos = datosBase(), rol: 'coordinador' | 'dispatch' = 'coordinador') {
  const app = await iniciarApp(datos, { rol });
  const { iniciarPlanificacion, cargarPlanificacion } = await import('../../src/scripts/planning/planningView');
  const { cargarAvisos } = await import('../../src/scripts/actions/planningNoticeActions');
  const { iniciarModalAlmuerzo } = await import('../../src/scripts/modals/lunchModal');
  app.appStore.set({ vista: 'planificacion' });
  iniciarPlanificacion();
  iniciarModalAlmuerzo();
  await cargarAvisos();
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

const avisoFila = (parcial: Record<string, unknown>) => ({
  id: 'a1', fecha_operativa: '2026-11-10', motivo: 'Falta Luis', autor_nombre: 'Dispatch Uno', creado_en: '2026-11-09T15:00:00Z',
  vence_en: '2026-11-10T12:00:00Z', visto: false,
  cambios: [{ en: '2026-11-09T15:01:00Z', por: 'Dispatch Uno', tecnico: 'Luis Mora', antes: 'Libre', despues: 'Turno C1 22:00 - 00:00' }],
  ...parcial
});

describe('planificación con aviso (D38)', () => {
  it('el dispatch edita sin esperar aprobación: el primer cambio de un día pide el motivo, una sola vez', async () => {
    const app = await abrirPlanificacion(datosBase(), 'dispatch');
    expect(app.celda('ana', '2026-11-09').querySelector('select')!.disabled).toBe(false);
    expect(app.celda('ana', '2026-11-12').querySelector('select')!.disabled).toBe(false);
    expect(app.celda('ana', '2026-11-08')?.querySelector('select')?.disabled ?? true).toBe(true);
    expect(app.q('#btnCopyPrevWeek').hasAttribute('data-coordinador-only')).toBe(true);

    app.pedirTexto.mockResolvedValueOnce('  Luis se reportó enfermo ');
    await app.elegir('luis', '2026-11-10', 'turnoC-22:00-00:00');
    expect(app.pedirTexto).toHaveBeenCalledTimes(1);
    expect(app.pedirTexto.mock.calls[0]![0]!.titulo).toBe('Cambio en la planificación del 10/11');
    expect(app.db.avisos_planificacion).toHaveLength(1);
    expect(app.db.avisos_planificacion![0]).toMatchObject({ fecha_operativa: '2026-11-10', motivo: 'Luis se reportó enfermo' });
    expect(app.db.jornadas!.find((j) => j.tecnico_id === 'luis' && j.fecha_operativa === '2026-11-10'))
      .toMatchObject({ turno: 'turnoC', horario_inicio: '22:00', horario_fin: '00:00' });
    expect(app.q('#planningGrid thead').textContent).toContain('Motivo indicado');

    // Mismo día: ya no lo pide · otro día: sí
    await app.elegir('ana', '2026-11-10', 'turnoB');
    expect(app.pedirTexto).toHaveBeenCalledTimes(1);
    await app.elegir('ana', '2026-11-11', 'turnoB');
    expect(app.pedirTexto).toHaveBeenCalledTimes(2);
    expect(app.db.avisos_planificacion).toHaveLength(2);
  });

  it('si el dispatch cancela el motivo, no se cambia nada', async () => {
    const app = await abrirPlanificacion(datosBase(), 'dispatch');
    const antes = app.db.jornadas!.length;
    app.pedirTexto.mockResolvedValueOnce(null);
    await app.elegir('luis', '2026-11-12', 'turnoA');
    expect(app.db.jornadas).toHaveLength(antes);
    expect(app.db.avisos_planificacion).toHaveLength(0);
    expect(app.celda('luis', '2026-11-12').querySelector('select')!.value).toBe('');
  });

  it('el almuerzo no pide motivo al dispatch', async () => {
    const app = await abrirPlanificacion(datosBase(), 'dispatch');
    const boton = app.celda('ana', '2026-11-09').querySelector<HTMLButtonElement>('.planning-lunch')!;
    expect(boton.disabled).toBe(false);
    app.click(boton);
    app.q<HTMLInputElement>('#lunchStart').value = '13:00';
    app.q<HTMLInputElement>('#lunchEnd').value = '13:30';
    app.q<HTMLFormElement>('#formLunch').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await esperar(80);
    expect(app.db.jornadas!.find((j) => j.id === 'j-ana')).toMatchObject({ almuerzo_inicio: '13:00', almuerzo_fin: '13:30' });
    expect(app.pedirTexto).not.toHaveBeenCalled();
  });

  it('coordinación ve los cambios con su motivo y los marca vistos', async () => {
    const app = await abrirPlanificacion({ ...datosBase(), avisos_planificacion: [avisoFila({})] });
    const lista = app.q('#planningNoticeList');
    expect(lista.textContent).toContain('Dispatch Uno cambió la planificación del 10/11 (1 cambio): Falta Luis');
    expect(lista.textContent).toContain('Luis Mora: Libre → Turno C1 22:00 - 00:00');
    expect(app.q('#planningGrid thead').textContent).toContain('Cambiado por dispatch');
    app.click(lista.querySelector('[data-action="marcar-aviso-visto"]')!);
    await esperar(80);
    expect(app.db.avisos_planificacion![0]!.visto).toBe(true);
    expect(lista.querySelector('[data-action="marcar-aviso-visto"]')).toBeNull();
  });

  it('la campana de coordinación suma los cambios sin ver; al abrir uno lo marca visto y lleva a ese día', async () => {
    const app = await abrirPlanificacion({ ...datosBase(), avisos_planificacion: [avisoFila({})] });
    const { iniciarCampanaDeAlertas } = await import('../../src/scripts/coordination/alertsBell');
    const abiertas: string[] = [];
    iniciarCampanaDeAlertas(() => undefined, (aviso) => abiertas.push(aviso.fecha));
    await esperar(80);
    expect(app.q('#alertsCount').textContent).toBe('1');
    app.click(app.q('#alertsList [data-aviso-id]'));
    await esperar(80);
    expect(abiertas).toEqual(['2026-11-10']);
    expect(app.db.avisos_planificacion![0]!.visto).toBe(true);
    expect(app.q('#alertsCount').classList.contains('hidden')).toBe(true);
  });
});
