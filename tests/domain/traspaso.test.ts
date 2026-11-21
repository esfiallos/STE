import { describe, expect, it } from 'vitest';
import { AREAS_DE_CASO, esAreaValida } from '../../src/domain/areas';
import { ETIQUETAS_SUGERIDAS } from '../../src/domain/followUp';
import { combinarBorrador, entradasDelReporte, itemInicial, normalizarItem, problemasDelTraspaso, receptoresDelTraspaso } from '../../src/domain/handoverDraft';
import { repartirCasos, tipoDeCaso, type CasoParaRepartir } from '../../src/domain/handoverBalance';
import { armarBloques, fechaEnTexto, reporteHtml, reporteTexto, reporteTsv, type FilaDeReporte } from '../../src/domain/handoverReport';
import type { Incidente, ItemTraspaso, Jornada, ReceptorTraspaso } from '../../src/types/noc';

const HOY = '2026-11-09';
const MANANA = '2026-11-10';

describe('áreas y etiquetas', () => {
  it('el catálogo de áreas es el pedido y la etiqueta VM se ofrece', () => {
    expect(AREAS_DE_CASO).toHaveLength(13);
    expect(esAreaValida('CORE IP')).toBe(true);
    expect(esAreaValida('core ip')).toBe(false);
    expect(esAreaValida(null)).toBe(false);
    expect(ETIQUETAS_SUGERIDAS).toContain('VM');
  });
});

describe('reparto de casos (balanceo)', () => {
  const caso = (id: string, receptorId: string | null, codigo = `INC${id}`, bloqueado = false): CasoParaRepartir => ({ id, codigo, receptorId, bloqueado });
  const cargas = (casos: CasoParaRepartir[], r: ReturnType<typeof repartirCasos>, receptores: string[]) => {
    const c = Object.fromEntries(receptores.map((n) => [n, 0]));
    for (const k of casos) c[r.asignaciones.get(k.id) ?? k.receptorId!]!++;
    return c;
  };

  it('clasifica el tipo por el código', () => {
    expect(['INC0045101', 'SCTASK0098402', '#INC-8841', 'RITM001'].map(tipoDeCaso)).toEqual(['INC', 'SCTASK', 'FRESH', 'OTRO']);
  });

  it('huérfanos: no toca lo ya asignado y reparte parejo lo demás', () => {
    const casos = [caso('1', 'a'), caso('2', 'a'), caso('3', 'b'), caso('4', 'x'), caso('5', null), caso('6', 'y')];
    const r = repartirCasos(casos, ['a', 'b'], 'huerfanos');
    expect(r.repartidos).toBe(3);
    for (const id of ['1', '2', '3']) expect(r.asignaciones.has(id)).toBe(false);
    const c = cargas(casos, r, ['a', 'b']);
    expect(Math.abs(c.a! - c.b!)).toBeLessThanOrEqual(1);
  });

  it('todos: equilibra moviendo el mínimo y respeta los candados', () => {
    const casos = [caso('1', 'a'), caso('2', 'a'), caso('3', 'a'), caso('4', 'a'), caso('5', 'b'), caso('6', 'b')];
    const r = repartirCasos(casos, ['a', 'b'], 'todos');
    expect(r.movidos).toBe(1);
    expect(cargas(casos, r, ['a', 'b'])).toEqual({ a: 3, b: 3 });

    const conCandado = [caso('1', 'a', 'INC1', true), caso('2', 'a', 'INC2', true), caso('3', 'a'), caso('4', 'b'), caso('5', null)];
    const r2 = repartirCasos(conCandado, ['a', 'b'], 'todos');
    expect(r2.asignaciones.has('1')).toBe(false);
    expect(r2.asignaciones.has('2')).toBe(false);
    const c = cargas(conCandado, r2, ['a', 'b']);
    expect(c.a! + c.b!).toBe(5);
    expect(Math.abs(c.a! - c.b!)).toBeLessThanOrEqual(1);
  });

  it('reparte la complejidad: cada uno recibe un INC y un SCTASK', () => {
    const casos = [caso('1', null, 'INC1'), caso('2', null, 'INC2'), caso('3', null, 'SCTASK3'), caso('4', null, 'SCTASK4')];
    const r = repartirCasos(casos, ['a', 'b'], 'huerfanos');
    const tipos = (n: string) => casos.filter((c) => r.asignaciones.get(c.id) === n).map((c) => tipoDeCaso(c.codigo)).sort().join();
    expect(tipos('a')).toBe('INC,SCTASK');
    expect(tipos('b')).toBe('INC,SCTASK');
  });

  it('sin receptores no reparte nada', () => {
    expect(repartirCasos([caso('1', null)], [], 'todos').repartidos).toBe(0);
  });
});

describe('borrador del traspaso', () => {
  const catalogo = [
    { id: 'ana', nombre: 'Ana', activo: true },
    { id: 'luis', nombre: 'Luis', activo: true },
    { id: 'marta', nombre: 'Marta', activo: true },
    { id: 'pedro', nombre: 'Pedro', activo: false },
    { id: 'carlos', nombre: 'Carlos', activo: true }
  ];
  const jornada = (tecnicoId: string, turno: Jornada['turno'], fecha = HOY): Jornada => ({
    id: `${tecnicoId}-${fecha}`, fecha, tecnicoId, turno, horarioInicio: null, horarioFin: null, almuerzoInicio: null, almuerzoFin: null
  });
  const jornadas = [
    jornada('ana', 'turnoA'), jornada('luis', 'turnoB'), jornada('marta', 'comodin'), jornada('pedro', 'turnoB'),
    jornada('carlos', 'turnoC'), jornada('ana', 'turnoA', MANANA), jornada('luis', 'turnoB', MANANA)
  ];

  it('A entrega a B y comodín de hoy; C a A y comodín de mañana (sin inactivos ni a sí mismo)', () => {
    expect(receptoresDelTraspaso('turnoA', HOY, jornadas, catalogo, 'ana').map((r) => `${r.nombre} ${r.fecha}`)).toEqual([
      `Marta ${HOY}`,
      `Luis ${HOY}`
    ]);
    expect(receptoresDelTraspaso('turnoC', HOY, jornadas, catalogo, 'carlos').map((r) => r.nombre)).toEqual(['Ana']);
    expect(receptoresDelTraspaso('turnoB', HOY, jornadas, catalogo, 'luis').map((r) => `${r.nombre} ${r.turno}`)).toEqual([
      'Carlos turnoC',
      'Ana turnoA'
    ]);
  });

  const casoBase = (id: string, extra: Partial<Incidente> = {}): Incidente => ({
    id, codigo: `INC${id}`, nota: null, tecnicoId: 'ana', creadoEn: '2026-11-09T12:00:00Z', estado: 'en_curso', ...extra
  });

  it('precarga estado, etiqueta, última actualización y recordatorio vigente del caso', () => {
    const item = itemInicial(casoBase('1', { estado: 'pausado', etiqueta: 'VM', ultimaActualizacion: 'Esperando', recordatorioFecha: MANANA, recordatorioTexto: 'VM 10:00' }), HOY);
    expect(item).toMatchObject({ estado: 'pausado', etiqueta: 'VM', ultimaActualizacion: 'Esperando', recordatorioFecha: MANANA, recordatorioTexto: 'VM 10:00', paraTecnicoId: null });
    expect(itemInicial(casoBase('2', { recordatorioFecha: '2026-11-01', recordatorioTexto: 'viejo' }), HOY).recordatorioFecha).toBeNull();
  });

  it('combina lo guardado con mis casos actuales y descarta lo que ya no es mío', () => {
    const guardado: ItemTraspaso = { ...itemInicial(casoBase('1'), HOY), paraTecnicoId: 'luis' };
    const ajeno: ItemTraspaso = itemInicial(casoBase('9'), HOY);
    const r = combinarBorrador([casoBase('1'), casoBase('2')], [guardado, ajeno], HOY);
    expect(r.items.map((i) => [i.casoId, i.paraTecnicoId])).toEqual([['1', 'luis'], ['2', null]]);
    expect(r.sobrantes).toEqual(['9']);
  });

  it('dice qué falta para cerrar turno', () => {
    const receptores = receptoresDelTraspaso('turnoA', HOY, jornadas, catalogo, 'ana');
    const casos = [casoBase('1'), casoBase('2'), casoBase('3'), casoBase('4')];
    const items: ItemTraspaso[] = [
      { ...itemInicial(casos[0]!, HOY), paraTecnicoId: 'luis', ultimaActualizacion: 'ok' },
      { ...itemInicial(casos[1]!, HOY), paraTecnicoId: 'carlos' },
      { ...itemInicial(casos[2]!, HOY), estado: 'cerrado' },
      { ...itemInicial(casos[3]!, HOY), paraTecnicoId: 'marta', ultimaActualizacion: 'ok', recordatorioTexto: 'VM' }
    ];
    expect(problemasDelTraspaso(items, casos, receptores, HOY).map((p) => p.mensaje)).toEqual([
      'INC2: el receptor ya no puede recibir de tu turno.',
      'INC2: falta la última actualización.',
      'INC4: el recordatorio necesita fecha.'
    ]);
    expect(problemasDelTraspaso(items.slice(0, 1), casos.slice(0, 1), [], HOY)[0]!.mensaje).toMatch(/No hay nadie planificado/);
  });

  it('normaliza lo escrito y limpia receptor y recordatorio de un caso cerrado', () => {
    const item = normalizarItem({ ...itemInicial(casoBase('1'), HOY), estado: 'cerrado', paraTecnicoId: 'luis', etiqueta: '  vm  ', notaPersonalizada: '  ', recordatorioFecha: MANANA });
    expect(item).toMatchObject({ paraTecnicoId: null, etiqueta: 'vm', notaPersonalizada: null, recordatorioFecha: null });
  });

  it('arma las entradas del reporte con la nota personalizada y deja fuera lo que aún no tiene receptor', () => {
    const receptores: ReceptorTraspaso[] = receptoresDelTraspaso('turnoA', HOY, jornadas, catalogo, 'ana');
    const destinos = new Map(receptores.map((r) => [r.tecnicoId, r]));
    const casos = [casoBase('1', { nota: 'ACME' }), casoBase('2', { nota: 'BETA' }), casoBase('3')];
    const items: ItemTraspaso[] = [
      { ...itemInicial(casos[0]!, HOY), paraTecnicoId: 'luis', notaPersonalizada: 'Llamar al NOC del cliente' },
      { ...itemInicial(casos[1]!, HOY) },
      { ...itemInicial(casos[2]!, HOY), estado: 'cerrado' }
    ];
    const entradas = entradasDelReporte(items, casos, destinos);
    expect(entradas.map((e) => [e.fila.codigo, e.destino?.nombre ?? null, e.fila.descripcion])).toEqual([
      ['INC1', 'Luis', 'Llamar al NOC del cliente'],
      ['INC3', null, null]
    ]);
  });
});

describe('reporte del traspaso', () => {
  const fila = (codigo: string, extra: Partial<FilaDeReporte> = {}): FilaDeReporte => ({
    codigo, empresa: 'ACME <SA>', area: 'CORE IP', estado: 'en_curso', etiqueta: null, descripcion: 'Caída & corte',
    ultimaActualizacion: 'Esperando proveedor', recordatorioFecha: null, recordatorioTexto: null, ...extra
  });
  const luis = { nombre: 'Luis', turno: 'turnoB' as const, fecha: HOY };
  const ana = { nombre: 'Ana', turno: 'turnoA' as const, fecha: MANANA };
  const bloques = () =>
    armarBloques([
      { destino: ana, fila: fila('INC2') },
      { destino: null, fila: fila('INC9', { estado: 'cerrado' }) },
      { destino: luis, fila: fila('SCTASK1') },
      { destino: luis, fila: fila('INC1', { etiqueta: 'VM', recordatorioFecha: MANANA, recordatorioTexto: 'VM 10:00' }) }
    ]);

  it('agrupa por receptor (día y turno), ordena INC antes que SCTASK y deja los cerrados al final', () => {
    const b = bloques();
    expect(b.map((x) => x.destino?.nombre ?? 'cerrados')).toEqual(['Luis', 'Ana', 'cerrados']);
    expect(b[0]!.filas.map((f) => f.codigo)).toEqual(['INC1', 'SCTASK1']);
    expect(fechaEnTexto('2026-11-17')).toBe('Martes 17 de noviembre de 2026');
  });

  it('HTML para Outlook: escapa el texto, usa bgcolor y pone la etiqueta y el recordatorio en el detalle', () => {
    const html = reporteHtml(bloques());
    expect(html).toContain('ACME &lt;SA&gt;');
    expect(html).toContain('Caída &amp; corte');
    expect(html).not.toContain('<SA>');
    expect(html).toContain('bgcolor="#FBE3C2"');
    expect(html).toContain('TURNO B');
    expect(html).toContain('Recordatorio 10/11: VM 10:00');
    const filaInc1 = html.split('<tr>').find((r) => r.includes('INC1'))!;
    const celdas = filaInc1.split('</td>');
    expect(celdas[0]).not.toContain('>VM<');
    expect(celdas[4]).toContain('>VM<');
    expect(reporteHtml(bloques(), { conEtiquetas: false })).not.toContain('>VM<');
    expect(reporteHtml([])).toBe('');
  });

  it('texto plano y TSV', () => {
    const texto = reporteTexto(bloques());
    expect(texto).toContain('Luis · TURNO B · Lunes 9 de noviembre de 2026');
    expect(texto).toContain('- INC1 · ACME <SA> · CORE IP · En curso · [VM] Caída & corte · Últ. act.: Esperando proveedor · Recordatorio 10/11: VM 10:00');
    const tsv = reporteTsv(bloques());
    expect(tsv.split('\n')[0]).toBe('TECNICO:\tLuis\tASIGNACION:\tTURNO B\t\t');
    expect(tsv).toContain('INC1\tACME <SA>\tCORE IP\tEn curso\t[VM] Caída & corte · Recordatorio 10/11: VM 10:00\tEsperando proveedor');
    expect(reporteTsv([{ destino: luis, filas: [fila('INC5', { descripcion: 'a\tb\nc' })] }])).toContain('\ta b c\t');
  });
});
