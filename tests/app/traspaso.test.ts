// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase, HOY } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(13);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Ana (turno A) tiene tres casos; Luis es turno B y Marta comodín: los dos pueden recibir. */
function datosDeAna() {
  const datos = datosBase();
  datos.casos = [
    { id: 'c1', codigo: 'INC1', nota: '<img src=x onerror=alert(1)>', cliente: 'ACME', area: 'CORE IP', estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:00:00Z', _fecha: HOY },
    { id: 'c2', codigo: 'SCTASK2', nota: 'BETA · enlace 77', estado: 'pausado', etiqueta: 'Monitoreo', descripcion: 'Esperando proveedor', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:30:00Z', _fecha: HOY },
    { id: 'c3', codigo: 'INC3', nota: null, estado: 'resuelto', descripcion: 'Listo', tecnico_actual_id: 'ana', creado_en: '2026-11-09T12:40:00Z', _fecha: HOY },
    { id: 'c9', codigo: 'INC9', nota: null, estado: 'en_curso', tecnico_actual_id: 'luis', creado_en: '2026-11-09T09:00:00Z', _fecha: HOY }
  ];
  return datos;
}

async function abrirTraspaso() {
  const app = await iniciarApp(datosDeAna(), { rol: 'tecnico', tecnicoId: 'ana' });
  const traspaso = await import('../../src/scripts/handover/handoverView');
  const misTraspasos = await import('../../src/scripts/handover/myHandoversView');
  traspaso.iniciarTraspaso('ana');
  misTraspasos.iniciarMisTraspasos('ana');
  await traspaso.cargarTraspaso();
  await esperar();

  const item = (casoId: string) => document.querySelector<HTMLElement>(`#handoverItems [data-caso-id="${casoId}"]`)!;
  const campo = <T extends HTMLElement>(casoId: string, nombre: string) => item(casoId).querySelector<T>(`[data-campo="${nombre}"]`)!;
  const escribir = (casoId: string, nombre: string, valor: string) => {
    const el = campo<HTMLInputElement>(casoId, nombre);
    el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const elegir = (casoId: string, nombre: string, valor: string) => {
    const el = campo<HTMLSelectElement>(casoId, nombre);
    el.value = valor;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const problemas = () => [...document.querySelectorAll('#handoverProblems li')].map((li) => li.textContent);
  return { ...app, traspaso, misTraspasos, item, campo, escribir, elegir, problemas };
}

describe('traspaso de fin de turno', () => {
  it('arma el borrador con mis casos precargados y solo ofrece receptores permitidos', async () => {
    const app = await abrirTraspaso();

    expect(app.qa('#handoverItems [data-caso-id]').map((el) => el.dataset.casoId)).toEqual(['c1', 'c2', 'c3']);
    expect(app.campo<HTMLInputElement>('c2', 'etiqueta').value).toBe('Monitoreo');
    expect(app.campo<HTMLTextAreaElement>('c2', 'descripcion').value).toBe('Esperando proveedor');
    expect(app.campo<HTMLSelectElement>('c2', 'estado').value).toBe('pausado');
    expect([...app.campo<HTMLSelectElement>('c1', 'receptor').options].map((o) => o.textContent)).toEqual([
      '— Elegir —',
      'Marta Soto · Comodín 07:00–17:00 · hoy',
      'Luis Mora · Turno B · hoy'
    ]);
    expect(app.problemas()).toContain('INC1: elige a quién se entrega.');
    expect(app.problemas()).toContain('INC1: falta la descripción.');
    expect(app.q<HTMLButtonElement>('#btnCerrarTurno').disabled).toBe(true);
    // Abrir la pestaña no crea nada en la base
    expect(app.db.traspasos).toHaveLength(0);
  });

  it('reparte, se puede deshacer y el reporte escapa el texto', async () => {
    const app = await abrirTraspaso();

    app.click(app.q('#btnRepartirPendientes'));
    const receptores = ['c1', 'c2', 'c3'].map((id) => app.campo<HTMLSelectElement>(id, 'receptor').value);
    expect(receptores.every((r) => r === 'luis' || r === 'marta')).toBe(true);
    expect(new Set(receptores).size).toBe(2);

    const html = app.q<HTMLIFrameElement>('#handoverPreview').srcdoc;
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');

    app.click(app.q('#btnDeshacerReparto'));
    expect(app.campo<HTMLSelectElement>('c1', 'receptor').value).toBe('');
  });

  it('guarda el borrador solo y cierra turno: los casos pasan a quien los recibe', async () => {
    const app = await abrirTraspaso();

    app.elegir('c1', 'receptor', 'luis');
    app.escribir('c1', 'descripcion', 'Cliente confirma mañana');
    // La descripción del traspaso es la del caso: al salir del campo se guarda en el caso (D21)
    app.campo('c1', 'descripcion').dispatchEvent(new Event('change', { bubbles: true }));
    app.elegir('c1', 'recordatorioFecha', '2026-11-10');
    app.escribir('c1', 'recordatorioTexto', 'VM programada');
    app.elegir('c2', 'receptor', 'marta');
    app.elegir('c3', 'estado', 'cerrado');
    expect(app.campo<HTMLSelectElement>('c3', 'receptor').disabled).toBe(true);
    expect(app.problemas()).toEqual(['Todo listo: puedes cerrar turno.']);

    await esperar(800); // guardado automático
    expect(app.db.traspasos).toHaveLength(1);
    expect(app.db.traspaso_items!.map((i) => [i.caso_id, i.para_tecnico_id, i.estado])).toEqual([
      ['c1', 'luis', 'en_curso'],
      ['c2', 'marta', 'pausado'],
      ['c3', null, 'cerrado']
    ]);
    expect(app.db.traspaso_items![0]).toMatchObject({ descripcion: 'Cliente confirma mañana', recordatorio_fecha: '2026-11-10', recordatorio_texto: 'VM programada' });
    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ descripcion: 'Cliente confirma mañana' });

    expect(app.q<HTMLButtonElement>('#btnCerrarTurno').disabled).toBe(false);
    app.click(app.q('#btnCerrarTurno'));
    await esperar(150);

    expect(app.confirmar).toHaveBeenCalledWith(expect.stringContaining('Se entregan 2 caso(s) y se cierran 1'));
    expect(app.escrituras.some((e) => e.startsWith('RPC enviar_traspaso'))).toBe(true);
    expect(app.db.casos!.find((c) => c.id === 'c1')).toMatchObject({ tecnico_actual_id: 'luis', descripcion: 'Cliente confirma mañana' });
    expect(app.db.casos!.find((c) => c.id === 'c3')!.estado).toBe('cerrado');
    expect(app.q('#handoverStatus').textContent).toContain('Ya cerraste turno hoy');
    expect(app.q('#handoverBody').classList.contains('hidden')).toBe(true);

    // Mis traspasos: lo entregado ese día, con el reporte para volver a copiar
    await app.misTraspasos.cargarMisTraspasos();
    const filas = app.qa('#mySent tbody tr').map((tr) => [...tr.children].map((td) => td.textContent));
    expect(filas.map((f) => [f[0], f[4]])).toEqual([
      ['INC1', 'Luis Mora'],
      ['INC3', 'Cerrado en el turno'],
      ['SCTASK2', 'Marta Soto']
    ]);
    expect(filas[0]![7]).toBe('10/11 · VM programada');
    app.click(app.q('#myHandoversCopy [data-copiar="outlook"]'));
    await esperar();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('al cerrar turno, cada receptor ve el caso en su Mi seguimiento con la descripción', async () => {
    // Una sola "base" compartida: primero entra Ana y cierra turno, después entran Luis y Marta
    const datos = { ...datosDeAna(), traspasos: [], traspaso_items: [] };
    await iniciarApp(datos, { rol: 'tecnico', tecnicoId: 'ana' });
    const traspaso = await import('../../src/scripts/handover/handoverView');
    traspaso.iniciarTraspaso('ana');
    await traspaso.cargarTraspaso();
    await esperar();
    const campo = (casoId: string, nombre: string) =>
      document.querySelector<HTMLInputElement>(`#handoverItems [data-caso-id="${casoId}"] [data-campo="${nombre}"]`)!;
    const elegir = (casoId: string, nombre: string, valor: string) => {
      campo(casoId, nombre).value = valor;
      campo(casoId, nombre).dispatchEvent(new Event('change', { bubbles: true }));
    };
    elegir('c1', 'descripcion', 'Cliente confirma mañana');
    await esperar(80);
    elegir('c1', 'receptor', 'luis');
    elegir('c2', 'receptor', 'marta');
    elegir('c3', 'receptor', 'marta');
    await esperar(800);
    document.querySelector<HTMLButtonElement>('#btnCerrarTurno')!.click();
    await esperar(200);
    expect(datos.casos.find((c) => c.id === 'c1')).toMatchObject({ tecnico_actual_id: 'luis', _origen: 'traspaso' });

    const seguimientoDe = async (tecnicoId: string) => {
      vi.unstubAllGlobals();
      await iniciarApp(datos, { rol: 'tecnico', tecnicoId });
      const seguimiento = await import('../../src/scripts/followUp/followUpView');
      seguimiento.iniciarSeguimiento(tecnicoId);
      await esperar(80);
      return [...document.querySelectorAll<HTMLElement>('[data-grupo="traspaso"] .followup-row[data-caso-id]')].map((fila) => [
        fila.querySelector('.followup-code')!.textContent,
        fila.querySelector<HTMLTextAreaElement>('[data-ref="descripcion"]')!.value
      ]);
    };
    expect(await seguimientoDe('luis')).toEqual([['INC1', 'Cliente confirma mañana']]);
    expect(await seguimientoDe('marta')).toEqual([
      ['SCTASK2', 'Esperando proveedor'],
      ['INC3', 'Listo']
    ]);
  });

  it('sin jornada hoy no deja armar el traspaso', async () => {
    const datos = datosDeAna();
    datos.jornadas = datos.jornadas.filter((j) => j.tecnico_id !== 'ana');
    await iniciarApp(datos, { rol: 'tecnico', tecnicoId: 'ana' });
    const traspaso = await import('../../src/scripts/handover/handoverView');
    traspaso.iniciarTraspaso('ana');
    await traspaso.cargarTraspaso();

    expect(document.querySelector('#handoverStatus')!.textContent).toContain('No tienes jornada planificada hoy');
    expect(document.querySelector('#handoverBody')!.classList.contains('hidden')).toBe(true);
  });
});

describe('mi seguimiento: área, empresa y recordatorio', () => {
  it('el técnico registra área y empresa, y ve el recordatorio; la descripción viaja con el caso', async () => {
    const datos = datosDeAna();
    Object.assign(datos.casos[1]!, { _origen: 'traspaso', recordatorio_fecha: '2026-11-10', recordatorio_texto: 'VM 10:00' });
    datos.traspasos = [{ id: 't1', de_tecnico_id: 'luis', fecha_operativa: '2026-11-08', estado: 'enviado', turno_origen: 'turnoB', enviado_en: '2026-11-09T04:00:00Z' }];
    datos.traspaso_items = [
      { id: 'i1', traspaso_id: 't1', caso_id: 'c2', para_tecnico_id: 'ana', estado: 'pausado', descripcion: 'Esperando proveedor', fecha_destino: HOY }
    ];
    const app = await iniciarApp(datos, { rol: 'tecnico', tecnicoId: 'ana' });
    const seguimiento = await import('../../src/scripts/followUp/followUpView');
    seguimiento.iniciarSeguimiento('ana');
    await esperar(80);

    const tarjeta = (codigo: string) => app.qa('#followUpView .followup-row[data-caso-id]').find((t) => t.textContent!.includes(codigo))!;
    expect(tarjeta('SCTASK2').querySelector('[data-ref="recordatorio"]')!.textContent).toBe('Recordar 10/11: VM 10:00');
    expect(tarjeta('SCTASK2').querySelector<HTMLTextAreaElement>('[data-ref="descripcion"]')!.value).toBe('Esperando proveedor');
    expect(tarjeta('INC1').querySelector<HTMLSelectElement>('[data-ref="area"]')!.value).toBe('CORE IP');

    const area = tarjeta('SCTASK2').querySelector<HTMLSelectElement>('[data-ref="area"]')!;
    area.value = 'TX';
    area.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(80);
    const empresa = tarjeta('SCTASK2').querySelector<HTMLInputElement>('[data-ref="empresa"]')!;
    empresa.value = '  Banco   Uno ';
    empresa.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(80);

    expect(app.db.casos!.find((c) => c.id === 'c2')).toMatchObject({ area: 'TX', cliente: 'Banco Uno' });
  });
});
