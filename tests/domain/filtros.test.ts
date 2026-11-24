import { describe, expect, it } from 'vitest';
import {
  conteoPorTipo,
  cuantosFiltros,
  cumpleFiltros,
  filtrarCasos,
  filtrosDesdeTexto,
  FILTROS_VACIOS,
  SIN_AREA,
  type CasoFiltrable
} from '../../src/domain/caseFilters';
import { ETIQUETA_TIPO, tipoDeCaso } from '../../src/domain/caseType';
import { ordenarPorAtraso } from '../../src/domain/followUp';
import type { Incidente } from '../../src/types/noc';

describe('tipo de caso (§11.11)', () => {
  it('FRESH = #SR o #INC · Tarea = SCTASK · Incidente = INC · lo demás, Otro', () => {
    expect(['#SR-1201', '#inc-8841', ' SCTASK0098402', 'INC0045101', 'RITM001', '#OTRO5', ''].map(tipoDeCaso)).toEqual([
      'FRESH', 'FRESH', 'SCTASK', 'INC', 'OTRO', 'OTRO', 'OTRO'
    ]);
    expect(ETIQUETA_TIPO.SCTASK).toBe('Tarea');
  });
});

describe('filtros de casos', () => {
  const casos: CasoFiltrable[] = [
    { codigo: 'INC1', tecnicoId: 'ana', area: 'CPE', estado: 'en_curso' },
    { codigo: 'SCTASK2', tecnicoId: 'ana', area: null, estado: 'pausado' },
    { codigo: '#SR3', tecnicoId: 'luis', area: 'CPE', estado: 'resuelto' },
    { codigo: 'INC4', tecnicoId: 'luis', area: 'TX' }
  ];
  const codigos = (f: Partial<typeof FILTROS_VACIOS>) => filtrarCasos(casos, { ...FILTROS_VACIOS, ...f }).map((c) => c.codigo);

  it('combina técnico, área (incluido "Sin área"), estado y tipo', () => {
    expect(codigos({})).toEqual(['INC1', 'SCTASK2', '#SR3', 'INC4']);
    expect(codigos({ tecnico: 'ana' })).toEqual(['INC1', 'SCTASK2']);
    expect(codigos({ area: 'CPE' })).toEqual(['INC1', '#SR3']);
    expect(codigos({ area: SIN_AREA })).toEqual(['SCTASK2']);
    expect(codigos({ estado: 'en_curso' })).toEqual(['INC1', 'INC4']); // sin estado cuenta como En curso
    expect(codigos({ tipo: 'INC', tecnico: 'luis' })).toEqual(['INC4']);
    expect(codigos({ tipo: 'FRESH', area: 'TX' })).toEqual([]);
    expect(cumpleFiltros(casos[0]!, FILTROS_VACIOS)).toBe(true);
    expect(cuantosFiltros({ ...FILTROS_VACIOS, tipo: 'INC', area: 'CPE' })).toBe(2);
  });

  it('el conteo por tipo respeta los otros filtros', () => {
    expect(conteoPorTipo(casos, FILTROS_VACIOS)).toEqual({ '': 4, FRESH: 1, SCTASK: 1, INC: 2, OTRO: 0 });
    expect(conteoPorTipo(casos, { ...FILTROS_VACIOS, tecnico: 'ana', tipo: 'FRESH' })).toEqual({ '': 2, FRESH: 0, SCTASK: 1, INC: 1, OTRO: 0 });
  });

  it('lee filtros guardados descartando valores inválidos', () => {
    expect(filtrosDesdeTexto('{"tipo":"INC","estado":"pausado","area":"CPE","tecnico":"ana"}')).toEqual({ tipo: 'INC', estado: 'pausado', area: 'CPE', tecnico: 'ana', atraso: '' });
    expect(filtrosDesdeTexto('{"atraso":"24"}').atraso).toBe('24');
    expect(filtrosDesdeTexto('{"atraso":"99"}').atraso).toBe('');
    expect(filtrosDesdeTexto('{"tipo":"X","estado":3}')).toEqual(FILTROS_VACIOS);
    expect(filtrosDesdeTexto('no es json')).toEqual(FILTROS_VACIOS);
    expect(filtrosDesdeTexto(null)).toEqual(FILTROS_VACIOS);
  });
});

describe('filtro por tiempo sin actualizar (D33)', () => {
  const ahora = new Date('2026-11-10T12:00:00Z');
  const hace = (horas: number) => new Date(ahora.getTime() - horas * 3_600_000).toISOString();
  const casos: CasoFiltrable[] = [
    { codigo: 'INC1', tecnicoId: 'ana', creadoEn: hace(1) },
    { codigo: 'INC2', tecnicoId: 'ana', creadoEn: hace(30), ultimaActualizacionEn: hace(3) },
    { codigo: 'INC3', tecnicoId: 'ana', creadoEn: hace(5) },
    { codigo: 'INC4', tecnicoId: 'ana', creadoEn: hace(30), sinTraspasoDesde: hace(20) },
    { codigo: 'INC5', tecnicoId: 'ana', creadoEn: hace(48), estado: 'cerrado' }
  ];
  const codigos = (atraso: typeof FILTROS_VACIOS.atraso) =>
    filtrarCasos(casos, { ...FILTROS_VACIOS, atraso }, ahora).map((c) => c.codigo);

  it('cuenta desde lo más reciente entre la última actualización y la llegada, sin los cerrados', () => {
    expect(codigos('2')).toEqual(['INC2', 'INC3', 'INC4']);
    expect(codigos('4')).toEqual(['INC3', 'INC4']);
    expect(codigos('24')).toEqual(['INC4']);
  });

  it('"Quedó sin traspaso" usa lo que calcula la base', () => {
    expect(codigos('sin_traspaso')).toEqual(['INC4']);
    expect(cuantosFiltros({ ...FILTROS_VACIOS, atraso: '6' })).toBe(1);
  });

  it('ordena los más olvidados primero, con los que quedaron sin traspaso adelante', () => {
    expect(ordenarPorAtraso(casos.slice(0, 4) as Incidente[], ahora).map((c) => c.codigo)).toEqual(['INC4', 'INC3', 'INC2', 'INC1']);
  });
});
