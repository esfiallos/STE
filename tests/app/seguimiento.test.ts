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

function datosDeAna() {
  const datos = datosBase();
  datos.casos = [
    { id: 'c1', codigo: 'INC1', nota: 'Fibra', cliente: 'ACME', estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:00:00Z', _fecha: HOY },
    { id: 'c2', codigo: 'INC2', nota: null, estado: 'pausado', etiqueta: 'Monitoreo', ultima_actualizacion: 'Esperando proveedor', ultima_actualizacion_en: '2026-11-09T11:00:00Z', ultima_actualizacion_por: 'luis@noc.test', tecnico_actual_id: 'ana', creado_en: '2026-11-09T11:00:00Z', _fecha: HOY, _origen: 'traspaso' },
    { id: 'c3', codigo: 'INC3', nota: null, estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '2026-11-09T21:00:00Z', _fecha: '2026-11-10', _origen: 'traspaso' },
    { id: 'c9', codigo: 'INC9', nota: null, estado: 'en_curso', tecnico_actual_id: 'luis', creado_en: '2026-11-09T09:00:00Z', _fecha: HOY }
  ];
  datos.notificaciones = [
    { id: 'n1', tecnico_id: 'ana', tipo: 'asignado', caso_id: 'c1', detalle: 'INC1', leida: false, creado_en: '2026-11-09T12:00:00Z' },
    { id: 'n2', tecnico_id: 'ana', tipo: 'traspaso', caso_id: 'c2', detalle: 'INC2', leida: true, creado_en: '2026-11-09T11:00:00Z' }
  ];
  datos.caso_responsables = [
    { id: 'r1', caso_id: 'c2', tecnico_nombre: 'Luis Mora', fecha_operativa: '2026-11-08', origen: 'dispatch', desde: '2026-11-08T20:00:00Z', hasta: '2026-11-09T11:00:00Z', asignado_por: 'dispatch@noc.test' },
    { id: 'r2', caso_id: 'c2', tecnico_nombre: 'Ana Pérez', fecha_operativa: HOY, origen: 'traspaso', desde: '2026-11-09T11:00:00Z', hasta: null, asignado_por: 'luis@noc.test' }
  ];
  return datos;
}

async function abrirSeguimiento() {
  const app = await iniciarApp(datosDeAna(), { rol: 'tecnico', tecnicoId: 'ana' });
  vi.doMock('../../src/services/notificacionesRepo', async (original) => ({
    ...(await original<typeof import('../../src/services/notificacionesRepo')>()),
    suscribirNotificaciones: () => () => undefined
  }));
  const seguimiento = await import('../../src/scripts/followUp/followUpView');
  const notificaciones = await import('../../src/scripts/notifications/notificationsPanel');
  seguimiento.iniciarSeguimiento('ana');
  notificaciones.iniciarNotificaciones('ana', (id) => seguimiento.resaltarCaso(id));
  await esperar(80);

  const tarjeta = (codigo: string) =>
    [...document.querySelectorAll<HTMLElement>('#followUpView .followup-card')].find((t) => t.textContent!.includes(codigo))!;
  const codigosDe = (grupo: string) =>
    [...document.querySelectorAll<HTMLElement>(`[data-grupo="${grupo}"] .followup-code`)].map((c) => c.textContent);
  return { ...app, seguimiento, notificaciones, tarjeta, codigosDe };
}

describe('mi seguimiento', () => {
  it('muestra solo mis casos: recibidos en traspaso (incluido el de mi próximo turno) y nuevos de hoy', async () => {
    const app = await abrirSeguimiento();

    expect(app.codigosDe('traspaso')).toEqual(['INC2', 'INC3']);
    expect(app.codigosDe('nuevos')).toEqual(['INC1']);
    expect(app.tarjeta('INC3').textContent).toContain('Para tu turno del 10/11/2026');
    expect(app.tarjeta('INC2').querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Esperando proveedor');
    expect(app.q('#followUpSummary').textContent).toBe('3 caso(s) abierto(s) · 2 sin última actualización');
    expect(app.q('#followUpBadge').textContent).toBe('2');
    expect(app.tarjeta('INC9')).toBeUndefined();
  });

  it('cambiar el estado y la etiqueta se guarda al momento', async () => {
    const app = await abrirSeguimiento();
    const estado = app.tarjeta('INC1').querySelector<HTMLSelectElement>('select')!;
    estado.value = 'pausado';
    estado.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(80);
    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ estado: 'pausado' });

    const etiqueta = app.tarjeta('INC1').querySelector<HTMLInputElement>('input[data-ref="etiqueta"]')!;
    etiqueta.value = '  Crítico ';
    etiqueta.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(80);
    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ etiqueta: 'Crítico' });
  });

  it('cerrar un caso pide confirmación', async () => {
    const app = await abrirSeguimiento();
    app.confirmar.mockReturnValue(false);
    const estado = app.tarjeta('INC1').querySelector<HTMLSelectElement>('select')!;
    estado.value = 'cerrado';
    estado.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(80);

    expect(app.confirmar).toHaveBeenCalledTimes(1);
    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ estado: 'en_curso' });
    expect(estado.value).toBe('en_curso');
  });

  it('la última actualización se guarda con el botón o con Ctrl+Enter', async () => {
    const app = await abrirSeguimiento();
    const texto = () => app.tarjeta('INC1').querySelector<HTMLTextAreaElement>('textarea')!;
    const guardar = () => app.tarjeta('INC1').querySelector<HTMLButtonElement>('[data-action="guardar-actualizacion"]')!;

    expect(guardar().disabled).toBe(true);
    texto().value = 'Cliente reinicia el equipo';
    texto().dispatchEvent(new Event('input', { bubbles: true }));
    expect(guardar().disabled).toBe(false);
    texto().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await esperar(80);

    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ ultima_actualizacion: 'Cliente reinicia el equipo' });
    expect(app.qa('.toast').some((t) => t.textContent!.includes('INC1: última actualización guardada'))).toBe(true);
  });

  it('muestra el historial de responsables y copia el resumen como texto', async () => {
    const app = await abrirSeguimiento();
    app.click(app.tarjeta('INC2').querySelector('[data-action="ver-historial"]')!);
    await esperar(80);
    const historial = [...app.tarjeta('INC2').querySelectorAll('.followup-history li')].map((li) => li.textContent);
    expect(historial).toHaveLength(2);
    expect(historial[0]).toContain('Luis Mora · Asignado por dispatch');
    expect(historial[1]).toContain('Ana Pérez · Recibido en traspaso');
    expect(historial[1]).toContain('(actual)');

    app.click(app.tarjeta('INC2').querySelector('[data-action="copiar-resumen"]')!);
    await esperar();
    expect(app.qa('.toast').some((t) => t.textContent!.includes('Resumen de INC2 copiado'))).toBe(true);
  });
});

describe('notificaciones', () => {
  it('la campana cuenta las no leídas; abrir una la marca y lleva al caso', async () => {
    const app = await abrirSeguimiento();
    expect(app.q('#notifCount').textContent).toBe('1');

    app.click(app.q('#btnNotifications'));
    expect(app.q('#notifPanel').classList.contains('hidden')).toBe(false);
    const items = app.qa('#notifList .notif__link');
    expect(items.map((i) => i.querySelector('.notif__text')!.textContent)).toEqual(['Te asignaron INC1', 'Recibiste en traspaso INC2']);

    app.click(items[0]!);
    await esperar(80);
    expect(app.db.notificaciones!.find((n) => n.id === 'n1')).toMatchObject({ leida: true });
    expect(app.q('#notifCount').classList.contains('hidden')).toBe(true);
    expect(app.tarjeta('INC1').classList.contains('is-highlight')).toBe(true);
  });

  it('una notificación en tiempo real avisa, suma a la campana y "marcar todas" las limpia', async () => {
    const app = await abrirSeguimiento();
    app.notificaciones.recibirNotificacion({ id: 'n3', tipo: 'traspaso', casoId: 'c3', detalle: 'INC3', leida: false, creadoEn: '2026-11-09T21:00:00Z' });
    app.notificaciones.recibirNotificacion({ id: 'n3', tipo: 'traspaso', casoId: 'c3', detalle: 'INC3', leida: false, creadoEn: '2026-11-09T21:00:00Z' }); // duplicada: se ignora

    expect(app.q('#notifCount').textContent).toBe('2');
    expect(app.qa('.toast').filter((t) => t.textContent === 'Recibiste en traspaso INC3')).toHaveLength(1);
    expect(app.q('#btnNotifications').classList.contains('is-ringing')).toBe(true);

    app.click(app.q('#btnNotifReadAll'));
    await esperar(80);
    expect(app.q('#notifCount').classList.contains('hidden')).toBe(true);
    expect(app.db.notificaciones!.filter((n) => n.tecnico_id === 'ana').every((n) => n.leida)).toBe(true);
  });
});

describe('mi columna en el tablero', () => {
  it('se resalta para el técnico con sesión', async () => {
    const app = await iniciarApp(datosDeAna(), { rol: 'tecnico', tecnicoId: 'ana' });
    expect(app.tarjeta('turnoA', 'ana').classList.contains('is-mine')).toBe(true);
    expect(app.tarjeta('turnoA', 'marta').classList.contains('is-mine')).toBe(false);
  });
});
