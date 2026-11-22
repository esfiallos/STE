import { describe, expect, it } from 'vitest';
import {
  agruparSeguimiento,
  contarNoLeidas,
  describirNotificacion,
  normalizarEtiqueta,
  resumenDeVarios,
  resumenParaCopiar,
  sinActualizar
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

  it('marca los casos que aún no tienen última actualización', () => {
    expect(sinActualizar([caso({ codigo: 'A' }), caso({ codigo: 'B', ultimaActualizacion: 'ok' }), caso({ codigo: 'C', ultimaActualizacion: '  ' })]).map((c) => c.codigo)).toEqual(['A', 'C']);
  });
});

describe('copiar como texto', () => {
  it('una línea por caso con estado, etiqueta, cliente, descripción y última actualización', () => {
    const c = caso({ codigo: 'INC1', estado: 'pausado', etiqueta: 'Monitoreo', cliente: 'ACME', descripcion: 'Caída', ultimaActualizacion: 'Esperando' });
    expect(resumenParaCopiar(c)).toBe('INC1 · Pausado · [Monitoreo] · ACME · Caída · Últ. act.: Esperando');
    expect(resumenParaCopiar(caso({ codigo: 'INC2' }))).toBe('INC2 · En curso');
    expect(resumenDeVarios([c, caso({ codigo: 'INC2' })]).split('\n')).toHaveLength(2);
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
