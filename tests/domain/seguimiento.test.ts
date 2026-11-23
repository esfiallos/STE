import { describe, expect, it } from 'vitest';
import {
  agruparSeguimiento,
  contarNoLeidas,
  describirNotificacion,
  normalizarEtiqueta,
  resumenDeVarios,
  resumenParaCopiar,
  sinDescripcion,
  agregarEtiquetaPropia,
  colorDeEtiqueta,
  haceCuanto,
  momentoCorto,
  nivelDeAtraso,
  opcionesDeEtiqueta
} from '../../src/domain/followUp';
import type { Incidente } from '../../src/types/noc';

const caso = (datos: Partial<Incidente>): Incidente => ({
  id: datos.codigo ?? 'x',
  codigo: 'INC0',
  nota: null,
  tecnicoId: 'ana',
  creadoEn: '2026-11-09T10:00:00Z',
  estado: 'en_curso',
  fechaResponsable: '2026-11-09',
  origenResponsable: 'dispatch',
  ...datos
});

describe('agrupar el seguimiento', () => {
  it('separa recibidos en traspaso (hoy o para mi próximo turno), nuevos de hoy y pendientes de días anteriores', () => {
    const grupos = agruparSeguimiento(
      [
        caso({ codigo: 'NUEVO' }),
        caso({ codigo: 'TRASPASO', origenResponsable: 'traspaso' }),
        caso({ codigo: 'MANANA', origenResponsable: 'traspaso', fechaResponsable: '2026-11-10' }),
        caso({ codigo: 'VIEJO', fechaResponsable: '2026-11-08' }),
        caso({ codigo: 'AJENO', tecnicoId: 'luis' }),
        caso({ codigo: 'CERRADO', estado: 'cerrado' })
      ],
      'ana',
      '2026-11-09'
    );
    expect(grupos.traspaso.map((c) => c.codigo)).toEqual(['TRASPASO', 'MANANA']);
    expect(grupos.nuevos.map((c) => c.codigo)).toEqual(['NUEVO']);
    expect(grupos.anteriores.map((c) => c.codigo)).toEqual(['VIEJO']);
  });

  it('marca los casos que aún no tienen descripción (la necesitan para el traspaso)', () => {
    expect(sinDescripcion([caso({ codigo: 'A' }), caso({ codigo: 'B', descripcion: 'ok' }), caso({ codigo: 'C', descripcion: '  ' })]).map((c) => c.codigo)).toEqual(['A', 'C']);
  });

  it('atraso sin actualizar en niveles 2/4/6 h, desde la última actualización o la llegada del caso', () => {
    const ahora = new Date('2026-11-09T18:00:00Z');
    expect(nivelDeAtraso({ creadoEn: '2026-11-09T17:00:00Z', ultimaActualizacionEn: null }, ahora)).toBe(0);
    expect(nivelDeAtraso({ creadoEn: '2026-11-09T15:30:00Z', ultimaActualizacionEn: null }, ahora)).toBe(2);
    expect(nivelDeAtraso({ creadoEn: '2026-11-09T08:00:00Z', ultimaActualizacionEn: '2026-11-09T13:30:00Z' }, ahora)).toBe(4);
    expect(nivelDeAtraso({ creadoEn: '2026-11-09T08:00:00Z', ultimaActualizacionEn: null }, ahora)).toBe(6);
    expect(nivelDeAtraso({ creadoEn: '', ultimaActualizacionEn: null }, ahora)).toBe(0);
  });

  it('tiempo relativo y momento corto', () => {
    const ahora = new Date('2026-11-09T18:00:00Z');
    expect(haceCuanto('2026-11-09T17:59:40Z', ahora)).toBe('recién');
    expect(haceCuanto('2026-11-09T17:25:00Z', ahora)).toBe('hace 35 min');
    expect(haceCuanto('2026-11-09T15:00:00Z', ahora)).toBe('hace 3 h');
    expect(haceCuanto('2026-11-07T15:00:00Z', ahora)).toBe('hace 2 d');
    expect(momentoCorto('2026-11-09T14:05:00')).toBe('09/11 14:05');
    expect(momentoCorto('no es fecha')).toBe('');
  });
});

describe('copiar como texto', () => {
  it('una línea por caso con estado, etiqueta, cliente, descripción y última actualización', () => {
    const c = caso({ codigo: 'INC1', estado: 'pausado', etiqueta: 'Monitoreo', cliente: 'ACME', descripcion: 'Caída', ultimaActualizacionEn: '2026-11-09T14:05:00' });
    expect(resumenParaCopiar(c)).toBe('INC1 · Pausado · [Monitoreo] · ACME · Caída · Últ. act.: 09/11 14:05');
    expect(resumenParaCopiar(caso({ codigo: 'INC2' }))).toBe('INC2 · En curso');
    expect(resumenDeVarios([c, caso({ codigo: 'INC2' })]).split('\n')).toHaveLength(2);
  });
});

describe('etiquetas propias y colores (D22)', () => {
  it('se recuerdan sin repetir (ni una sugerida), la más reciente primero y con tope', () => {
    expect(agregarEtiquetaPropia([], '  Proveedor   externo ')).toEqual(['Proveedor externo']);
    expect(agregarEtiquetaPropia(['Proveedor'], 'proveedor')).toEqual(['proveedor']);
    expect(agregarEtiquetaPropia(['Proveedor'], 'critico')).toEqual(['Proveedor']);
    expect(agregarEtiquetaPropia(['A'], '   ')).toEqual(['A']);
    const muchas = Array.from({ length: 30 }, (_, i) => `E${i}`);
    expect(agregarEtiquetaPropia(muchas, 'Nueva')).toHaveLength(30);
    expect(agregarEtiquetaPropia(muchas, 'Nueva')[0]).toBe('Nueva');
  });

  it('opciones: sugeridas, propias y la actual; color por etiqueta', () => {
    expect(opcionesDeEtiqueta(['Proveedor'], 'Otra cosa')).toEqual(['Crítico', 'Escalar', 'VM', 'Monitoreo', 'Pendiente cliente', 'Seguimiento', 'Proveedor', 'Otra cosa']);
    expect(opcionesDeEtiqueta([], 'vm')).toHaveLength(6);
    expect(colorDeEtiqueta('Crítico')).toBe('critico');
    expect(colorDeEtiqueta('Proveedor')).toBe('otra');
    expect(colorDeEtiqueta(null)).toBeNull();
  });
});

describe('notificaciones y etiquetas', () => {
  it('describe y cuenta las no leídas', () => {
    expect(describirNotificacion({ tipo: 'traspaso', detalle: 'INC1' })).toBe('Recibiste en traspaso INC1');
    expect(describirNotificacion({ tipo: 'asignado', detalle: null })).toBe('Te asignaron un caso');
    expect(contarNoLeidas([{ leida: false }, { leida: true }, { leida: false }] as never)).toBe(2);
  });

  it('normaliza la etiqueta escrita', () => {
    expect(normalizarEtiqueta('  Pendiente   cliente ')).toBe('Pendiente cliente');
    expect(normalizarEtiqueta('   ')).toBeNull();
    expect(normalizarEtiqueta('x'.repeat(60))).toHaveLength(40);
  });
});
