// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const codigos = (db: { casos?: Record<string, unknown>[] }, tecnico: string) =>
  db.casos!.filter((c) => c.tecnico_actual_id === tecnico && c.estado !== 'cerrado').map((c) => c.codigo);

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
    expect(app.db.casos!.filter((c) => c.codigo === 'INC1')).toHaveLength(1);
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
    expect(app.db.casos!.some((c) => c.codigo === 'INC9')).toBe(false);
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

describe('casos que ya existen fuera del tablero de hoy', () => {
  const conCerrado = () => {
    const datos = datosBase();
    datos.casos.push({ id: 'i5', codigo: 'INC5', nota: null, estado: 'cerrado', tecnico_actual_id: 'luis', creado_en: '', _fecha: '2026-11-01' });
    return datos;
  };

  it('un caso cerrado se reabre al asignarlo de nuevo (con confirmación)', async () => {
    const app = await iniciarApp(conCerrado());

    const resultado = await app.solicitarAsignacion(' inc5 ', '', 'marta');
    await esperar();

    expect(String(app.confirmar.mock.calls[0]![0])).toContain('está cerrado (último responsable: Luis Mora)');
    expect(resultado?.ok).toBe(true);
    expect(app.db.casos!.find((c) => c.codigo === 'INC5')).toMatchObject({ estado: 'en_curso', tecnico_actual_id: 'marta' });
    expect(app.tarjeta('turnoA', 'marta').textContent).toContain('INC5');
  });

  it('si no se confirma, el caso cerrado sigue cerrado', async () => {
    const app = await iniciarApp(conCerrado());
    app.confirmar.mockReturnValue(false);

    expect(await app.solicitarAsignacion('INC5', '', 'marta')).toBeNull();
    expect(app.db.casos!.find((c) => c.codigo === 'INC5')).toMatchObject({ estado: 'cerrado' });
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

  it('el dispatch no tiene botón de cerrar: cancela con motivo y el caso deja de existir', async () => {
    const app = await iniciarApp();
    const tarjetaAna = () => app.tarjeta('turnoA', 'ana');
    expect(tarjetaAna().querySelector('[data-action="quitar-incidente"]')).toBeNull();

    app.click(tarjetaAna().querySelector('[data-action="cancelar-incidente"]')!);
    expect(app.q('#modalCancelIncident').classList.contains('hidden')).toBe(false);
    expect(app.q('#cancelIncidentCode').textContent).toBe('INC1');
    expect(app.q('#cancelIncidentTech').textContent).toBe('Ana Pérez');
    app.q<HTMLInputElement>('#cancelIncidentReason').value = 'Número mal escrito';
    app.q<HTMLFormElement>('#formCancelIncident').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await esperar(80);

    expect(app.escrituras.find((e) => e.startsWith('RPC cancelar_caso'))).toContain('"p_motivo":"Número mal escrito"');
    expect(app.db.casos).toHaveLength(0);
    expect(app.q('#modalCancelIncident').classList.contains('hidden')).toBe(true);
    expect(tarjetaAna().querySelectorAll('.incident-item-card')).toHaveLength(0);
  });

  it('avisa al cancelar si el técnico ya trabajó el caso', async () => {
    const datos = datosBase();
    Object.assign(datos.casos[0]!, { estado: 'pausado', area: 'CPE' });
    const app = await iniciarApp(datos);
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="cancelar-incidente"]')!);
    const aviso = app.q('#cancelIncidentWorked');
    expect(aviso.classList.contains('hidden')).toBe(false);
    expect(aviso.textContent).toContain('cambió el estado');
    expect(aviso.textContent).toContain('registró el área');
  });

  it('el dispatch corrige código y empresa desde la tarjeta', async () => {
    const app = await iniciarApp();
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="editar-incidente"]')!);
    expect(app.q<HTMLInputElement>('#editIncidentCode').value).toBe('INC1');
    app.q<HTMLInputElement>('#editIncidentCode').value = ' inc11 ';
    app.q<HTMLInputElement>('#editIncidentCompany').value = 'ACME';
    app.q<HTMLFormElement>('#formEditIncident').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await esperar(80);

    expect(app.db.casos).toMatchObject([{ codigo: 'INC11', cliente: 'ACME', estado: 'en_curso' }]);
    const tarjeta = app.tarjeta('turnoA', 'ana');
    expect(tarjeta.querySelector('.inc-code')!.textContent).toBe('INC11');
    expect(tarjeta.querySelector('.inc-company')!.textContent).toBe('ACME');
  });

  it('el formulario rápido guarda la empresa del caso', async () => {
    const app = await iniciarApp();
    app.click(app.tarjeta('turnoA', 'ana').querySelector('[data-action="asignar"]')!);
    const formulario = app.tarjeta('turnoA', 'ana').querySelector<HTMLFormElement>('form[data-form="asignar"]')!;
    formulario.querySelector<HTMLInputElement>('[name="codigo"]')!.value = 'INC5';
    formulario.querySelector<HTMLInputElement>('[name="empresa"]')!.value = ' Beta ';
    formulario.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await esperar(80);
    expect(app.db.casos!.find((c) => c.codigo === 'INC5')).toMatchObject({ cliente: 'Beta', tecnico_actual_id: 'ana' });
  });
});
