// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase, HOY } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10); // turno A en curso
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('disponibilidad en el tablero', () => {
  it('marca a cada técnico según su horario y deshabilita el "+" de quien no puede recibir casos', async () => {
    const app = await iniciarApp();

    expect(app.tarjeta('turnoA', 'ana').dataset.disponible).toBe('true');
    expect(app.tarjeta('turnoB', 'luis').dataset.disponible).toBe('false');
    expect(app.tarjeta('turnoB', 'luis').querySelector('.status-chip')?.textContent).toBe('Fuera de horario');
    expect(app.tarjeta('turnoB', 'luis').querySelector<HTMLButtonElement>('[data-action="asignar"]')!.disabled).toBe(true);
    expect(app.qa('.badge-live')).toHaveLength(0);
  });

  it('el comodín aparece en los turnos que su horario toca (A y B) y no en C', async () => {
    const app = await iniciarApp();

    expect(app.qa('[data-tecnico-id="marta"]')).toHaveLength(2);
    expect(app.qa('[data-turno-id="turnoC"] [data-tecnico-id="marta"]')).toHaveLength(0);
    expect(app.tarjeta('turnoA', 'marta').querySelector('.schedule-chip')?.textContent).toContain('07:00 - 17:00');
  });

  it('cuenta a cada técnico una sola vez en las métricas', async () => {
    const app = await iniciarApp();

    expect(document.getElementById('statActiveTechs')!.textContent).toBe('2'); // Ana + la comodín
    expect(document.getElementById('statInLunchTechs')!.textContent).toBe('0');
  });

  it('en el almuerzo la columna se tiñe, no recibe casos y el almuerzo es un elemento amarillo', async () => {
    const app = await iniciarApp();
    fijarHora(12, 10);
    app.solicitarRender();

    const ana = app.tarjeta('turnoA', 'ana');
    expect(ana.classList.contains('is-almuerzo')).toBe(true);
    expect(ana.querySelector('.status-chip')!.textContent).toBe('En almuerzo');
    expect(ana.querySelector('.lunch-item')!.classList.contains('is-active')).toBe(true);
    expect(ana.querySelector('.lunch-text')!.textContent).toContain('hasta las 12:30');
    expect(ana.querySelector<HTMLButtonElement>('[data-action="asignar"]')!.disabled).toBe(true);
    expect(document.getElementById('statInLunchTechs')!.textContent).toBe('1');
  });

  it('a las 15:00 entra el turno B y sale el A', async () => {
    const app = await iniciarApp();
    fijarHora(15);
    app.solicitarRender();

    expect(app.tarjeta('turnoB', 'luis').dataset.disponible).toBe('true');
    expect(app.tarjeta('turnoA', 'ana').dataset.disponible).toBe('false');
  });

  it('el almuerzo sin horario se muestra como un elemento vacío', async () => {
    const app = await iniciarApp();
    expect(app.tarjeta('turnoA', 'marta').querySelector('.lunch-item')!.classList.contains('is-empty')).toBe(true);
    expect(app.tarjeta('turnoA', 'ana').querySelector('.lunch-text')!.textContent).toBe('Almuerzo 12:00 - 12:30');
  });
});

describe('incidentes: copiar y ver el comentario', () => {
  it('ver el comentario y copiar son botones distintos, y el comentario no se interpreta como HTML', async () => {
    const app = await iniciarApp();
    const incidente = () => app.tarjeta('turnoA', 'ana').querySelector('.incident-item-card')!;
    const nota = () => incidente().querySelector('.inc-note')!;

    expect(nota().classList.contains('hidden')).toBe(true);
    app.click(incidente().querySelector('[data-action="ver-nota"]')!);
    expect(nota().classList.contains('hidden')).toBe(false);
    expect(incidente().querySelectorAll('img')).toHaveLength(0);
    expect(nota().textContent).toContain('<img');

    app.click(incidente().querySelector('[data-action="ver-nota"]')!);
    expect(nota().classList.contains('hidden')).toBe(true);

    app.click(incidente().querySelector('[data-action="copiar-codigo"]')!);
    await esperar();
    expect(app.qa('.toast').some((t) => t.textContent!.includes('INC1 copiado'))).toBe(true);
  });
});

describe('rol técnico: solo lectura', () => {
  it('oculta la edición y bloquea las acciones, pero permite ver y copiar', async () => {
    const app = await iniciarApp(undefined, { rol: 'tecnico' });
    const antes = JSON.stringify(app.db.casos);

    expect(document.body.classList.contains('solo-lectura')).toBe(true);
    app.click(app.tarjeta('turnoA', 'marta').querySelector('[data-action="asignar"]')!);
    expect(app.tarjeta('turnoA', 'ana').querySelector('[data-action="cancelar-incidente"]')).not.toBeNull(); // oculto por CSS
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="cancelar-incidente"]')!);
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="editar-incidente"]')!);
    await esperar();
    expect(app.q('#modalCancelIncident').classList.contains('hidden')).toBe(true);
    expect(app.q('#modalEditIncident').classList.contains('hidden')).toBe(true);

    expect(JSON.stringify(app.db.casos)).toBe(antes);
    expect(app.escrituras).toHaveLength(0);
    expect(app.qa('form[data-form="asignar"]')).toHaveLength(0);
    expect(await app.solicitarAsignacion('INC9', '', 'ana')).toMatchObject({ ok: false });
  });
});

describe('día operativo (06:00 → 06:00)', () => {
  const ayer = () => {
    const datos = datosBase();
    datos.jornadas = [
      { id: 'j-c', fecha_operativa: '2026-11-08', tecnico_id: 'luis', turno: 'turnoC', horario_inicio: null, horario_fin: null, almuerzo_inicio: null, almuerzo_fin: null }
    ];
    datos.casos = [
      { id: 'i1', codigo: 'INC1', nota: null, estado: 'en_curso', tecnico_actual_id: 'luis', creado_en: '2026-11-08T23:00:00Z', _fecha: '2026-11-08' }
    ];
    return datos;
  };

  it('a las 05:59 el turno C de ayer sigue en el tablero', async () => {
    fijarHora(5, 59);
    const app = await iniciarApp(ayer());

    expect(app.tarjeta('turnoC', 'luis').dataset.disponible).toBe('true');
    expect(app.tarjeta('turnoC', 'luis').querySelectorAll('.incident-item-card')).toHaveLength(1);
    expect(app.qa('.reassign-strip')).toHaveLength(0);
  });

  it('a las 06:00 el tablero empieza limpio y los casos abiertos de ayer quedan "por reasignar"', async () => {
    fijarHora(6, 0);
    const app = await iniciarApp(ayer());

    expect(app.qa('.tech-column-card')).toHaveLength(0);
    expect(app.q('#shiftsAccordionContainer')!.textContent).toContain('Aún no hay técnicos planificados para hoy');
    const franja = app.q<HTMLElement>('.reassign-strip');
    expect(franja.textContent).toContain('Por reasignar (1)');
    expect(franja.textContent).toContain('Último: Luis Mora');
  });

  it('los casos traspasados para mañana todavía no aparecen hoy', async () => {
    const datos = datosBase();
    datos.casos.push({ id: 'i2', codigo: 'INC2', nota: null, estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '', _fecha: '2026-11-10' });
    const app = await iniciarApp(datos);

    expect(app.tarjeta('turnoA', 'ana').querySelectorAll('.incident-item-card')).toHaveLength(1);
  });
});

describe('tablero del día (D16): solo lo que asignó el dispatch hoy', () => {
  const columna = (app: Awaited<ReturnType<typeof iniciarApp>>, turno: string, tecnico: string) =>
    [...app.tarjeta(turno, tecnico).querySelectorAll('.inc-code')].map((c) => c.textContent);

  it('lo recibido en traspaso y lo de días anteriores no está en el tablero ni cuenta en las métricas', async () => {
    const datos = datosBase();
    datos.casos.push(
      { id: 'i2', codigo: 'INC2', nota: null, estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '', _fecha: HOY, _origen: 'traspaso' },
      { id: 'i3', codigo: 'INC3', nota: null, estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '', _fecha: '2026-11-08' }
    );
    const app = await iniciarApp(datos);

    expect(columna(app, 'turnoA', 'ana')).toEqual(['INC1']);
    expect(app.q('#statTotalIncidents').textContent).toBe('1');
    // Ana trabaja hoy: lo de ayer sigue en su seguimiento, no "por reasignar"
    expect(app.qa('.reassign-strip')).toHaveLength(0);
  });

  it('un caso cuyo turno terminó sin traspaso pasa a "por reasignar" aunque su responsable trabaje hoy (D33)', async () => {
    const datos = datosBase();
    datos.casos.push({
      id: 'i3', codigo: 'INC3', nota: null, estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '', _fecha: '2026-11-08',
      sin_traspaso_desde: '2026-11-08T20:00:00Z'
    });
    const app = await iniciarApp(datos);

    const franja = app.q<HTMLElement>('.reassign-strip');
    expect(franja.textContent).toContain('Por reasignar (1)');
    expect(franja.querySelector('.reassign-strip__owner--alerta')!.textContent).toBe('Ana Pérez: terminó su turno (08/11 14:00) sin traspasarlo');
  });

  it('un cerrado sigue en su columna, atenuado y sin acciones; un traspasado sigue donde lo puso el dispatch', async () => {
    const datos = datosBase();
    datos.casos.push(
      { id: 'i2', codigo: 'INC2', cliente: 'ACME', nota: null, estado: 'cerrado', tecnico_actual_id: 'marta', creado_en: '', _fecha: HOY },
      { id: 'i3', codigo: 'INC3', nota: null, estado: 'pausado', tecnico_actual_id: 'luis', creado_en: '', _fecha: HOY, _origen: 'traspaso', _tableroFecha: HOY, _tableroTecnico: 'marta' }
    );
    const app = await iniciarApp(datos);

    expect(columna(app, 'turnoA', 'marta')).toEqual(['INC2', 'INC3']);
    const cerrado = app.tarjeta('turnoA', 'marta').querySelector<HTMLElement>('[data-incidente-id="i2"]')!;
    expect(cerrado.classList.contains('is-closed')).toBe(true);
    expect(cerrado.draggable).toBe(false);
    expect(cerrado.querySelector('[data-action="cancelar-incidente"]')).toBeNull();
    expect(cerrado.querySelector('.inc-state')!.textContent).toBe('Cerrado');
    expect(cerrado.querySelector('.inc-company')!.textContent).toBe('ACME');
    expect(app.tarjeta('turnoA', 'marta').querySelector('.tech-case-count')!.textContent).toBe('2 caso(s) · 1 cerrado(s)');
    expect(columna(app, 'turnoB', 'luis')).toEqual([]);
  });

  it('"Por reasignar" solo lo ve el dispatch', async () => {
    const datos = () => {
      const d = datosBase();
      d.casos.push({ id: 'i9', codigo: 'INC9', nota: null, estado: 'en_curso', tecnico_actual_id: 'pedro', creado_en: '', _fecha: '2026-11-08' });
      return d;
    };
    expect((await iniciarApp(datos())).qa('.reassign-strip')).toHaveLength(1);
    vi.unstubAllGlobals();
    expect((await iniciarApp(datos(), { rol: 'coordinador' })).qa('.reassign-strip')).toHaveLength(0);
  });
});

describe('filtro por técnico', () => {
  it('muestra solo las columnas del técnico elegido, en todos sus turnos', async () => {
    const app = await iniciarApp();
    const filtro = app.q<HTMLSelectElement>('#filterTech');

    expect([...filtro.options].map((o) => o.textContent)).toEqual([
      'Todos los técnicos',
      'Ana Pérez · Turno A',
      'Luis Mora · Turno B',
      'Marta Soto · Comodín'
    ]);

    filtro.value = 'marta';
    filtro.dispatchEvent(new Event('change'));
    expect(app.qa('.tech-column-card').map((t) => t.dataset.tecnicoId)).toEqual(['marta', 'marta']);

    filtro.value = '';
    filtro.dispatchEvent(new Event('change'));
    expect(app.qa('.tech-column-card')).toHaveLength(4);
  });
});
