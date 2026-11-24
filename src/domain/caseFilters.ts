/**
 * Filtros de casos (§11.11): técnico · área · estado · tipo · sin actualizar, combinables. Los usan el Tablero, Mi seguimiento,
 * el Traspaso, Buscar casos y el Panel (cada vista ofrece los que tienen sentido para ella).
 */
import type { EstadoCaso, Incidente } from '../types/noc';
import { tipoDeCaso, TIPOS_DE_CASO, type TipoDeCaso } from './caseType';
import { horasSinActualizar } from './followUp';

/** Valor de "Sin área" en el filtro (no choca con ningún área del catálogo). */
export const SIN_AREA = '-';

export interface FiltrosDeCasos {
  /** Id del técnico ('' = todos). */
  tecnico: string;
  /** Área del catálogo, SIN_AREA o '' (todas). */
  area: string;
  estado: EstadoCaso | '';
  tipo: TipoDeCaso | '';
  /** Horas mínimas sin actualizar ('2', '4', '6', '24'), 'sin_traspaso' (D33) o '' (cualquiera). */
  atraso: FiltroDeAtraso | '';
}

export const FILTROS_DE_ATRASO = ['2', '4', '6', '24', 'sin_traspaso'] as const;
export type FiltroDeAtraso = (typeof FILTROS_DE_ATRASO)[number];

export const ETIQUETA_ATRASO: Record<FiltroDeAtraso, string> = {
  '2': 'Sin actualizar +2 h',
  '4': 'Sin actualizar +4 h',
  '6': 'Sin actualizar +6 h',
  '24': 'Sin actualizar +1 día',
  sin_traspaso: 'Quedó sin traspaso'
};

export type CampoDeFiltro = keyof FiltrosDeCasos;

export const FILTROS_VACIOS: Readonly<FiltrosDeCasos> = { tecnico: '', area: '', estado: '', tipo: '', atraso: '' };

/** Lo mínimo que necesita un caso para filtrarse. */
export type CasoFiltrable = Pick<Incidente, 'codigo' | 'tecnicoId'> &
  Partial<Pick<Incidente, 'area' | 'estado' | 'ultimaActualizacionEn' | 'creadoEn' | 'sinTraspasoDesde'>>;

function cumpleAtraso(caso: CasoFiltrable, atraso: FiltroDeAtraso, ahora: Date): boolean {
  if (caso.estado === 'cerrado') return false;
  if (atraso === 'sin_traspaso') return !!caso.sinTraspasoDesde;
  const horas = horasSinActualizar(caso, ahora);
  return horas !== null && horas >= Number(atraso);
}

export function cumpleFiltros(caso: CasoFiltrable, filtros: FiltrosDeCasos, ahora: Date = new Date()): boolean {
  if (filtros.tecnico && caso.tecnicoId !== filtros.tecnico) return false;
  if (filtros.area === SIN_AREA ? !!caso.area : filtros.area && caso.area !== filtros.area) return false;
  if (filtros.estado && (caso.estado ?? 'en_curso') !== filtros.estado) return false;
  if (filtros.tipo && tipoDeCaso(caso.codigo) !== filtros.tipo) return false;
  if (filtros.atraso && !cumpleAtraso(caso, filtros.atraso, ahora)) return false;
  return true;
}

export function filtrarCasos<T extends CasoFiltrable>(casos: readonly T[], filtros: FiltrosDeCasos, ahora: Date = new Date()): T[] {
  return hayFiltros(filtros) ? casos.filter((c) => cumpleFiltros(c, filtros, ahora)) : [...casos];
}

export function hayFiltros(filtros: FiltrosDeCasos): boolean {
  return cuantosFiltros(filtros) > 0;
}

export function cuantosFiltros(filtros: FiltrosDeCasos): number {
  return (Object.values(filtros) as string[]).filter(Boolean).length;
}

/**
 * Cuántos casos hay de cada tipo, respetando los demás filtros (para los contadores de los chips de tipo):
 * así el número de cada chip dice cuántos quedarían al elegirlo.
 */
export function conteoPorTipo(casos: readonly CasoFiltrable[], filtros: FiltrosDeCasos): Record<TipoDeCaso | '', number> {
  const base = casos.filter((c) => cumpleFiltros(c, { ...filtros, tipo: '' }));
  const conteo = { '': base.length } as Record<TipoDeCaso | '', number>;
  for (const tipo of TIPOS_DE_CASO) conteo[tipo] = 0;
  for (const c of base) conteo[tipoDeCaso(c.codigo)]++;
  return conteo;
}

/** Lee filtros guardados (sessionStorage) tolerando datos viejos o rotos. */
export function filtrosDesdeTexto(texto: string | null): FiltrosDeCasos {
  try {
    const v = JSON.parse(texto ?? '{}') as Partial<Record<CampoDeFiltro, unknown>>;
    const cadena = (x: unknown) => (typeof x === 'string' ? x : '');
    const tipo = cadena(v.tipo);
    const estado = cadena(v.estado);
    const atraso = cadena(v.atraso);
    return {
      tecnico: cadena(v.tecnico),
      area: cadena(v.area),
      estado: (['en_curso', 'pausado', 'resuelto', 'cerrado'].includes(estado) ? estado : '') as EstadoCaso | '',
      tipo: ((TIPOS_DE_CASO as readonly string[]).includes(tipo) ? tipo : '') as TipoDeCaso | '',
      atraso: ((FILTROS_DE_ATRASO as readonly string[]).includes(atraso) ? atraso : '') as FiltroDeAtraso | ''
    };
  } catch {
    return { ...FILTROS_VACIOS };
  }
}
