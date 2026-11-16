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

const codigos = (db: { incidentes?: Record<string, unknown>[] }, tecnico: string) =>
  db.incidentes!.filter((i) => i.tecnico_id === tecnico).map((i) => i.codigo);

describe('asignación rápida desde la tarjeta', () => {
  it('abre el formulario con el foco en el número, no pierde lo escrito si llegan cambios y asigna al enviar', async () => {
    const app = await iniciarApp();
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="asignar"]')!);

    const formulario = () => app.tarjeta('turnoA', 'ana').querySelector<HTMLFormElement>('form[data-form="asignar"]')!;
    const campo = () => formulario().querySelector<HTMLInputElement>('[name="codigo"]')!;
    expect(formulario()).toBeTruthy();
    expect(document.activeElement).toBe(campo());

    campo().value = ' inc2 ';
    campo().dispatchEvent(new Event('input', { bubbles: true }));
    await app.cargarDatos(); // llega un cambio mientras se escribe
    await esperar();
    expect(campo().value).toBe(' inc2 ');

    formulario().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await esperar(80);

    expect(codigos(app.db, 'ana')).toContain('INC2');
    expect(app.qa('form[data-form="asignar"]')).toHaveLength(0);
    expect(app.tarjeta('turnoA', 'ana').querySelectorAll('.incident-item-card')).toHaveLength(2);
  });
});

describe('reglas de asignación', () => {
  it('un INC no puede estar con dos técnicos: ofrece reasignarlo', async () => {
    const app = await iniciarApp();

    const resultado = await app.solicitarAsignacion('inc1', '', 'marta');
    await esperar();

    expect(app.confirmar).toHaveBeenCalledTimes(1);
    expect(resultado?.ok).toBe(true);
    expect(app.db.incidentes!.filter((i) => i.codigo === 'INC1')).toHaveLength(1);
    expect(codigos(app.db, 'marta')).toEqual(['INC1']);
  });

  it('si la persona cancela la reasignación no cambia nada', async () => {
    const app = await iniciarApp();
    app.confirmar.mockReturnValue(false);

    expect(await app.solicitarAsignacion('INC1', '', 'marta')).toBeNull();
    expect(codigos(app.db, 'ana')).toEqual(['INC1']);
  });

  it('asignarlo al técnico que ya lo tiene devuelve un aviso', async () => {
    const app = await iniciarApp();
    const resultado = await app.solicitarAsignacion('INC1', '', 'ana');

    expect(resultado && !resultado.ok && resultado.error).toContain('ya está asignado a Ana');
  });

  it('un técnico fuera de horario no recibe casos', async () => {
    const app = await iniciarApp();
    const resultado = await app.solicitarAsignacion('INC9', '', 'luis');

    expect(resultado && !resultado.ok && resultado.error).toContain('fuera de su horario (14:00 - 22:00)');
    expect(app.db.incidentes!.some((i) => i.codigo === 'INC9')).toBe(false);
  });

  it('un técnico en almuerzo no recibe casos', async () => {
    const app = await iniciarApp();
    fijarHora(12, 10);
    const resultado = await app.solicitarAsignacion('INC77', '', 'ana');

    expect(resultado && !resultado.ok && resultado.error).toContain('en su almuerzo hasta las 12:30');
  });

  it('el modal "Nuevo incidente" solo ofrece técnicos disponibles y no pide turno', async () => {
    const app = await iniciarApp();
    app.abrirModalAsignar();

    const opciones = [...document.querySelectorAll<HTMLOptionElement>('#selectTechnician option')].map((o) => o.textContent);
    expect(opciones).toEqual(['Selecciona un técnico', 'Ana Pérez', 'Marta Soto']);
    expect(document.getElementById('selectShift')).toBeNull();

    fijarHora(12, 10);
    app.abrirModalAsignar();
    const duranteAlmuerzo = [...document.querySelectorAll<HTMLOptionElement>('#selectTechnician option')].map((o) => o.textContent);
    expect(duranteAlmuerzo).toEqual(['Selecciona un técnico', 'Marta Soto']);
  });
});

describe('arrastrar y soltar', () => {
  it('no acepta soltar sobre un técnico no disponible, y sí sobre uno disponible', async () => {
    const app = await iniciarApp();
    const origen = app.tarjeta('turnoA', 'ana').querySelector('.incident-item-card')!;
    origen.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));

    const sobreLuis = new Event('dragover', { bubbles: true, cancelable: true });
    app.tarjeta('turnoB', 'luis').dispatchEvent(sobreLuis);
    expect(sobreLuis.defaultPrevented).toBe(false);
    expect(app.tarjeta('turnoB', 'luis').classList.contains('drag-blocked')).toBe(true);

    const sobreMarta = new Event('dragover', { bubbles: true, cancelable: true });
    app.tarjeta('turnoA', 'marta').dispatchEvent(sobreMarta);
    expect(sobreMarta.defaultPrevented).toBe(true);

    app.tarjeta('turnoA', 'marta').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    origen.dispatchEvent(new Event('dragend', { bubbles: true }));
    await esperar(80);

    expect(codigos(app.db, 'marta')).toEqual(['INC1']);
  });

  it('quitar un incidente lo elimina', async () => {
    const app = await iniciarApp();
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="quitar-incidente"]')!);
    await esperar(80);

    expect(app.db.incidentes).toHaveLength(0);
  });
});
