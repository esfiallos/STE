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

const caso = (codigo: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-incidente-id]')].find((t) => t.textContent?.includes(codigo))!;
const conteo = (tarjeta: HTMLElement) => tarjeta.querySelector<HTMLElement>('[data-ref="conteo"]')!;

describe('animaciones del tablero', () => {
  it('el primer dibujo no anima nada', async () => {
    const app = await iniciarApp();
    expect(app.qa('.is-entering, .is-moved, .is-receiving, .is-popping')).toHaveLength(0);
  });

  it('un caso nuevo entra, la columna que lo recibe se realza y su contador hace pop', async () => {
    const app = await iniciarApp();
    await app.solicitarAsignacion('INC20', '', 'marta');
    await esperar();

    expect(caso('INC20').classList.contains('is-entering')).toBe(true);
    expect(app.tarjeta('turnoA', 'marta').classList.contains('is-receiving')).toBe(true);
    expect(conteo(app.tarjeta('turnoA', 'marta')).classList.contains('is-popping')).toBe(true);
    // El resto del tablero no se anima
    expect(caso('INC1').classList.contains('is-entering')).toBe(false);
    expect(app.tarjeta('turnoA', 'ana').classList.contains('is-receiving')).toBe(false);
  });

  it('un caso reasignado se marca como movido y cambian los dos contadores', async () => {
    const app = await iniciarApp();
    await app.solicitarAsignacion('INC1', '', 'marta');
    await esperar();

    expect(caso('INC1').classList.contains('is-moved')).toBe(true);
    expect(app.tarjeta('turnoA', 'marta').classList.contains('is-receiving')).toBe(true);
    expect(conteo(app.tarjeta('turnoA', 'ana')).classList.contains('is-popping')).toBe(true);
    expect(conteo(app.tarjeta('turnoA', 'marta')).classList.contains('is-popping')).toBe(true);
  });

  it('si el tablero se vuelve a dibujar a media animación, la retoma donde iba', async () => {
    const app = await iniciarApp();
    await app.solicitarAsignacion('INC21', '', 'ana');
    await esperar();
    const primera = caso('INC21');

    app.solicitarRender(); // otro dibujo (p. ej. se cerró el formulario)
    const segunda = caso('INC21');
    expect(segunda).not.toBe(primera);
    expect(segunda.classList.contains('is-entering')).toBe(true);
    expect(segunda.style.animationDelay).toMatch(/^-\d+ms$/);
  });

  it('colapsar y abrir un turno no confunde casos ya existentes con nuevos', async () => {
    const app = await iniciarApp();
    const { appStore } = app;
    appStore.set({ turnosColapsados: ['turnoA'] });
    appStore.set({ turnosColapsados: [] });
    expect(caso('INC1').classList.contains('is-entering')).toBe(false);
  });
});
