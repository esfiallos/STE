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
    { id: 'c2', codigo: 'INC2', nota: null, estado: 'pausado', etiqueta: 'Monitoreo', descripcion: 'Esperando proveedor', ultima_actualizacion_en: '2026-11-09T11:00:00Z', ultima_actualizacion_por: 'luis@noc.test', tecnico_actual_id: 'ana', creado_en: '2026-11-09T11:00:00Z', _fecha: HOY, _origen: 'traspaso' },
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

async function abrirSeguimiento(datos = datosDeAna()) {
  const app = await iniciarApp(datos, { rol: 'tecnico', tecnicoId: 'ana' });
  vi.doMock('../../src/services/notificacionesRepo', async (original) => ({
    ...(await original<typeof import('../../src/services/notificacionesRepo')>()),
    suscribirNotificaciones: () => () => undefined
  }));
  const seguimiento = await import('../../src/scripts/followUp/followUpView');
  const notificaciones = await import('../../src/scripts/notifications/notificationsPanel');
  const abiertosEnBuscador: string[] = [];
  seguimiento.iniciarSeguimiento('ana', { abrirEnBuscador: (codigo) => abiertosEnBuscador.push(codigo) });
  notificaciones.iniciarNotificaciones('ana', (id) => seguimiento.resaltarCaso(id));
  await esperar(80);

  const tarjeta = (codigo: string) =>
    [...document.querySelectorAll<HTMLElement>('#followUpView .followup-row[data-caso-id]')].find((t) => t.querySelector('.followup-code')!.textContent === codigo)!;
  const codigosDe = (grupo: string) =>
    [...document.querySelectorAll<HTMLElement>(`[data-grupo="${grupo}"] .followup-code`)].map((c) => c.textContent);
  return { ...app, seguimiento, notificaciones, tarjeta, codigosDe, abiertosEnBuscador };
}

describe('mi seguimiento', () => {
  it('muestra solo mis casos: recibidos en traspaso (incluido el de mi próximo turno) y nuevos de hoy', async () => {
    const app = await abrirSeguimiento();

    expect(app.codigosDe('traspaso')).toEqual(['INC2', 'INC3']);
    expect(app.codigosDe('nuevos')).toEqual(['INC1']);
    expect(app.tarjeta('INC3').textContent).toContain('Para tu turno del 10/11/2026');
    expect(app.tarjeta('INC2').querySelector<HTMLTextAreaElement>('[data-ref="descripcion"]')!.value).toBe('Esperando proveedor');
    expect(app.q('#followUpSummary').textContent).toBe('3 caso(s) abierto(s) · 2 sin descripción (la necesitan para el traspaso)');
    expect(app.q('#followUpBadge').textContent).toBe('2');
    expect(app.tarjeta('INC9')).toBeUndefined();
    // Contadores por grupo y "última actualización" como fecha relativa
    expect(app.q('[data-grupo="traspaso"] [data-ref="conteo"]').textContent).toBe('2');
    expect(app.tarjeta('INC1').querySelector('[data-ref="hace"]')!.textContent).toBe('Sin actualizar');
    expect(app.tarjeta('INC2').querySelector('[data-ref="hace"]')!.textContent).toMatch(/^hace /);
    // La nota histórica del dispatch queda como pista, sin copiarse a la descripción
    expect(app.tarjeta('INC1').querySelector<HTMLTextAreaElement>('[data-ref="descripcion"]')!.placeholder).toBe('Nota del dispatch: Fibra');
  });

  it('cambiar el estado y la etiqueta se guarda al momento', async () => {
    const app = await abrirSeguimiento();
    const estado = app.tarjeta('INC1').querySelector<HTMLSelectElement>('[data-ref="estado"]')!;
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
    const estado = app.tarjeta('INC1').querySelector<HTMLSelectElement>('[data-ref="estado"]')!;
    estado.value = 'cerrado';
    estado.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(80);

    expect(app.confirmar).toHaveBeenCalledTimes(1);
    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ estado: 'en_curso' });
    expect(estado.value).toBe('en_curso');
  });

  it('la descripción se guarda con Ctrl+Enter (o al salir) y marca la última actualización; Esc deshace', async () => {
    const app = await abrirSeguimiento();
    const texto = () => app.tarjeta('INC1').querySelector<HTMLTextAreaElement>('[data-ref="descripcion"]')!;

    texto().focus();
    texto().value = 'Cliente reinicia el equipo';
    texto().dispatchEvent(new Event('input', { bubbles: true }));
    expect(texto().classList.contains('is-dirty')).toBe(true);
    texto().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await esperar(80);

    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ descripcion: 'Cliente reinicia el equipo' });
    expect(app.db.casos!.find((c) => c.id === 'c1')!.ultima_actualizacion_en).toBeTruthy();
    expect(app.qa('.toast').some((t) => t.textContent!.includes('INC1: descripción guardada'))).toBe(true);
    expect(app.tarjeta('INC1').querySelector('[data-ref="hace"]')!.textContent).toBe('recién');

    texto().focus();
    texto().value = 'algo que no quiero';
    texto().dispatchEvent(new Event('input', { bubbles: true }));
    texto().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await esperar(80);
    expect(texto().value).toBe('Cliente reinicia el equipo');
    expect(app.escrituras.filter((e) => e.startsWith('PATCH casos'))).toHaveLength(1);
  });

  it('"Actualizado" marca la fecha sin cambiar nada', async () => {
    const app = await abrirSeguimiento();
    app.click(app.tarjeta('INC1').querySelector('[data-action="marcar-actualizado"]')!);
    await esperar(80);
    expect(app.escrituras.some((e) => e.startsWith('RPC marcar_actualizado') && e.includes('"p_caso":"c1"'))).toBe(true);
    expect(app.tarjeta('INC1').querySelector('[data-ref="hace"]')!.textContent).toBe('recién');
    expect(app.db.casos!.find((c) => c.id === 'c1')!.descripcion).toBeUndefined();
  });

  it('el borde de la fila avisa el atraso sin actualizar y los grupos se pliegan', async () => {
    fijarHora(19); // INC1 llegó 12:00 UTC (≈ 06:00 local) y nunca se tocó
    const app = await abrirSeguimiento();
    expect(Number(app.tarjeta('INC1').dataset.atraso)).toBeGreaterThan(0);

    const titulo = app.q<HTMLButtonElement>('[data-grupo="nuevos"] [data-action="alternar-grupo"]');
    app.click(titulo);
    expect(app.q('[data-grupo="nuevos"]').classList.contains('is-collapsed')).toBe(true);
    expect(titulo.getAttribute('aria-expanded')).toBe('false');
  });

  it('estado y área se pintan con su color y cambian al elegir otro (§14.2)', async () => {
    const datos = datosDeAna();
    datos.casos[0]!.area = 'CORE IP';
    const app = await abrirSeguimiento(datos);
    const estado = app.tarjeta('INC2').querySelector<HTMLSelectElement>('[data-ref="estado"]')!;
    expect(estado.classList.contains('estado-color--pausado')).toBe(true);
    expect(app.tarjeta('INC1').querySelector('[data-ref="area"]')!.classList.contains('area-color--core-ip')).toBe(true);
    expect(app.tarjeta('INC2').querySelector('[data-ref="area"]')!.classList.contains('area-color')).toBe(false);
  });

  it('marca lo que quedó sin traspaso y filtra por tiempo sin actualizar (D33)', async () => {
    const datos = datosDeAna();
    datos.casos[0]!.sin_traspaso_desde = '2026-11-09T14:00:00Z';
    const app = await abrirSeguimiento(datos);

    const chip = app.tarjeta('INC1').querySelector<HTMLElement>('[data-ref="sinTraspaso"]')!;
    expect(chip.classList.contains('hidden')).toBe(false);
    expect(chip.textContent).toBe('Sin traspasar desde 09/11 08:00');
    expect(app.tarjeta('INC2').querySelector('[data-ref="sinTraspaso"]')!.classList.contains('hidden')).toBe(true);

    const filtro = app.q<HTMLSelectElement>('#followUpFilters [data-filtro="atraso"]');
    filtro.value = 'sin_traspaso';
    filtro.dispatchEvent(new Event('change', { bubbles: true }));
    expect([...app.codigosDe('traspaso'), ...app.codigosDe('nuevos')]).toEqual(['INC1']);

    filtro.value = '4'; // 10:00: INC1 llegó 06:00 (4 h) e INC2 se actualizó 05:00 (5 h); INC3 es para mañana
    filtro.dispatchEvent(new Event('change', { bubbles: true }));
    expect([...app.codigosDe('traspaso'), ...app.codigosDe('nuevos')]).toEqual(['INC2', 'INC1']);
    filtro.value = '';
    filtro.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('el orden "más tiempo sin actualizar" pone primero lo más olvidado', async () => {
    const app = await abrirSeguimiento();
    const orden = app.q<HTMLSelectElement>('#followUpOrder');
    orden.value = 'atraso';
    orden.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.codigosDe('traspaso')).toEqual(['INC2', 'INC3']);
    orden.value = 'asignacion';
    orden.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('el historial se abre en Buscar casos (no ocupa la fila) y copia el resumen como texto (§14.5)', async () => {
    const app = await abrirSeguimiento();
    app.click(app.tarjeta('INC2').querySelector('[data-action="ver-historial"]')!);
    expect(app.abiertosEnBuscador).toEqual(['INC2']);
    expect(app.tarjeta('INC2').querySelector('.followup-history')).toBeNull();

    app.click(app.tarjeta('INC2').querySelector('[data-action="copiar-resumen"]')!);
    await esperar();
    expect(app.qa('.toast').some((t) => t.textContent!.includes('Resumen de INC2 copiado'))).toBe(true);
  });
});

describe('notificaciones', () => {
  it('el aviso de traspaso pendiente lleva a la pestaña Traspaso (D34)', async () => {
    const datos = datosDeAna();
    datos.notificaciones = [{
      id: 'n9', tecnico_id: 'ana', tipo: 'cierre_pendiente', caso_id: null, leida: false, creado_en: '2026-11-09T19:30:00Z',
      detalle: 'tu turno termina a las 14:00 y tienes 2 caso(s) por traspasar'
    }];
    const app = await abrirSeguimiento(datos);
    window.location.hash = '';

    const aviso = app.q<HTMLElement>('#notifList [data-notificacion-id="n9"]');
    expect(aviso.textContent).toContain('Traspaso pendiente: tu turno termina a las 14:00 y tienes 2 caso(s) por traspasar');
    aviso.click();
    expect(window.location.hash).toBe('#traspaso');
  });

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
