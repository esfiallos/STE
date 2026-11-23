import { describe, expect, it } from 'vitest';
import {
  chipsDeFecha,
  describirDistancia,
  describirFechaCorta,
  interpretarFecha,
  semanasDelMes,
  sumarMeses
} from '../../src/domain/dateInput';
import { filtrarOpciones, mismoTexto } from '../../src/domain/search';

// Lunes 9 de noviembre de 2026
const HOY = '2026-11-09';
const f = (texto: string, direccion: 'futuro' | 'pasado' = 'futuro') => interpretarFecha(texto, HOY, direccion);

describe('interpretarFecha (D24)', () => {
  it('atajos de texto', () => {
    expect(f('h')).toBe(HOY);
    expect(f(' Hoy ')).toBe(HOY);
    expect(f('m')).toBe('2026-11-10');
    expect(f('mañana')).toBe('2026-11-10');
    expect(f('manana')).toBe('2026-11-10');
    expect(f('pm')).toBe('2026-11-11');
    expect(f('pasado mañana')).toBe('2026-11-11');
    expect(f('ayer')).toBe('2026-11-08');
    expect(f('anteayer')).toBe('2026-11-07');
  });

  it('días relativos', () => {
    expect(f('+3')).toBe('2026-11-12');
    expect(f('+ 30')).toBe('2026-12-09');
    expect(f('-2')).toBe('2026-11-07');
  });

  it('días de la semana: el próximo (o el último en dirección "pasado"); hoy cuenta', () => {
    expect(f('lun')).toBe(HOY);
    expect(f('mar')).toBe('2026-11-10');
    expect(f('mie')).toBe('2026-11-11');
    expect(f('miércoles')).toBe('2026-11-11');
    expect(f('vie')).toBe('2026-11-13');
    expect(f('do')).toBe('2026-11-15');
    expect(f('vie', 'pasado')).toBe('2026-11-06');
    expect(f('lunes', 'pasado')).toBe(HOY);
  });

  it('día del mes: este mes o el siguiente (anterior en "pasado")', () => {
    expect(f('25')).toBe('2026-11-25');
    expect(f('9')).toBe(HOY);
    expect(f('3')).toBe('2026-12-03');
    expect(f('3', 'pasado')).toBe('2026-11-03');
    expect(f('25', 'pasado')).toBe('2026-10-25');
    expect(f('31')).toBe('2026-12-31'); // noviembre no tiene 31
  });

  it('D/M, D/M/AA, D/M/AAAA e ISO; fechas imposibles no valen', () => {
    expect(f('25/11')).toBe('2026-11-25');
    expect(f('3/1')).toBe('2027-01-03'); // enero ya pasó hace más de un mes: el próximo
    expect(f('3-1', 'pasado')).toBe('2026-01-03');
    expect(f('1.12.26')).toBe('2026-12-01');
    expect(f('15/02/2027')).toBe('2027-02-15');
    expect(f('2026-12-24')).toBe('2026-12-24');
    expect(f('31/11/2026')).toBeNull();
    expect(f('30/02')).toBeNull();
  });

  it('lo que no se entiende devuelve null', () => {
    for (const texto of ['', '   ', 'x', 'mañanaa', '1/2/3/4', '+', 'abc']) expect(f(texto)).toBeNull();
  });

  it('textos de ayuda, chips y calendario', () => {
    expect(describirFechaCorta('2026-11-21', HOY)).toBe('sáb 21/11');
    expect(describirFechaCorta('2027-01-02', HOY)).toBe('sáb 2/1/2027');
    expect(describirDistancia('2026-11-10', HOY)).toBe('Mañana');
    expect(describirDistancia('2026-11-15', HOY)).toBe('en 6 días');
    expect(describirDistancia('2026-11-06', HOY)).toBe('hace 3 días');

    expect(chipsDeFecha(HOY, 'futuro').map((c) => c.texto)).toEqual(['Hoy', 'Mañana', 'Pasado mañana', 'jue 12/11', 'vie 13/11', 'sáb 14/11', 'dom 15/11']);
    expect(chipsDeFecha(HOY, 'pasado', { maximo: HOY }).map((c) => c.texto)).toEqual(['Hoy', 'Ayer', 'Anteayer', 'vie 6/11', 'jue 5/11', 'mié 4/11', 'mar 3/11']);
    expect(chipsDeFecha(HOY, 'futuro', { minimo: '2026-11-10', maximo: '2026-11-12' }).map((c) => c.fecha)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);

    const semanas = semanasDelMes(HOY);
    expect(semanas).toHaveLength(6);
    expect(semanas[0]![0]).toBe('2026-10-26'); // lunes de la semana del 1/11 (domingo)
    expect(sumarMeses('2026-12-15', 1)).toBe('2027-01-01');
  });
});

describe('opciones del combobox (D22)', () => {
  const ETIQUETAS = ['Crítico', 'Monitoreo', 'Pendiente cliente', 'Escalar', 'VM'];

  it('filtra sin mayúsculas ni acentos: primero las que empiezan igual', () => {
    expect(filtrarOpciones(ETIQUETAS, '')).toEqual(ETIQUETAS);
    expect(filtrarOpciones(ETIQUETAS, 'crit')).toEqual(['Crítico']);
    expect(filtrarOpciones(ETIQUETAS, 'e')).toEqual(['Escalar', 'Monitoreo', 'Pendiente cliente']);
    expect(filtrarOpciones(ETIQUETAS, 'zzz')).toEqual([]);
    expect(mismoTexto(' CRITICO ', 'Crítico')).toBe(true);
  });
});
