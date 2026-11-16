// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';

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

describe('Modo Consulta', () => {
  it('oculta la edición y bloquea las acciones, pero permite ver y copiar', async () => {
    const app = await iniciarApp();
    const cantidad = app.db.incidentes!.length;

    app.click(document.getElementById('btnToggleMode')!);
    expect(document.body.classList.contains('modo-consulta')).toBe(true);

    app.click(app.tarjeta('turnoA', 'marta').querySelector('[data-action="asignar"]')!);
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="quitar-incidente"]')!);
    await esperar();

    expect(app.db.incidentes).toHaveLength(cantidad);
    expect(app.qa('form[data-form="asignar"]')).toHaveLength(0);

    app.click(document.getElementById('btnToggleMode')!);
    expect(document.body.classList.contains('modo-consulta')).toBe(false);
  });
});
