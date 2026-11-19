// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10); // lunes 9/11/2026
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function abrirPlanificacion(datos = datosBase()) {
  const app = await iniciarApp(datos);
  const { iniciarPlanificacion, cargarPlanificacion } = await import('../../src/scripts/planning/planningView');
  const { iniciarModalAlmuerzo } = await import('../../src/scripts/modals/lunchModal');
  iniciarPlanificacion();
  iniciarModalAlmuerzo();
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

describe('planificación semanal', () => {
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
