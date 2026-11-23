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
    expect(filtrosDesdeTexto('{"tipo":"INC","estado":"pausado","area":"CPE","tecnico":"ana"}')).toEqual({ tipo: 'INC', estado: 'pausado', area: 'CPE', tecnico: 'ana' });
    expect(filtrosDesdeTexto('{"tipo":"X","estado":3}')).toEqual(FILTROS_VACIOS);
    expect(filtrosDesdeTexto('no es json')).toEqual(FILTROS_VACIOS);
    expect(filtrosDesdeTexto(null)).toEqual(FILTROS_VACIOS);
  });
});
