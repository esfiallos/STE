/**
 * Reporte del traspaso (portado de traspasos-noc/services/report.js y sorting.js): un bloque por receptor
 * y tres salidas puras — tabla HTML para Outlook (estilos en línea + bgcolor, lo único que Outlook respeta),
 * texto plano y TSV para Excel. Todo el texto del usuario se escapa: el HTML resultante es seguro.
 */
import type { EstadoCaso, TurnoTecnico } from '../types/noc';
import { ETIQUETAS_SUGERIDAS, momentoCorto } from './followUp';
import { ETIQUETA_ESTADO_CASO } from './handover';
import { ORDEN_DE_TIPO, tipoDeCaso } from './handoverBalance';

/** Una fila del reporte: un caso con lo que se entrega. */
export interface FilaDeReporte {
  codigo: string;
  empresa: string | null;
  area: string | null;
  estado: EstadoCaso;
  etiqueta: string | null;
  /** Descripción con la que se entrega (D21); si no hay, la nota histórica del caso. */
  descripcion: string | null;
  /** Última vez que el técnico tocó el caso (ISO); se muestra como "Últ. act.: 21/11 14:05". */
  ultimaActualizacionEn: string | null;
  recordatorioFecha: string | null;
  recordatorioTexto: string | null;
}

/** A quién va un bloque (null = casos cerrados en el turno, no se entregan). */
export interface DestinoDeBloque {
  nombre: string;
  turno: TurnoTecnico;
  fecha: string;
  horarioInicio?: string | null;
  horarioFin?: string | null;
}

export interface BloqueDeReporte {
  destino: DestinoDeBloque | null;
  filas: FilaDeReporte[];
}

export type OrdenDeReporte = 'tipo' | 'etiqueta' | 'empresa';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-11-17" → "Martes 17 de noviembre de 2026" (sin Intl: igual en cualquier navegador). */
export function fechaEnTexto(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const diaSemana = (new Date(anio!, mes! - 1, dia!).getDay() + 6) % 7;
  return `${DIAS[diaSemana]} ${dia} de ${MESES[mes! - 1]} de ${anio}`;
}

/** "2026-11-17" → "17/11". */
export const fechaCorta = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

export function asignacionEnTexto(destino: DestinoDeBloque | null): string {
  if (!destino) return 'CERRADOS EN EL TURNO';
  if (destino.turno === 'comodin') {
    const horario = destino.horarioInicio && destino.horarioFin ? ` ${destino.horarioInicio}–${destino.horarioFin}` : '';
    return `COMODÍN${horario}`;
  }
  return `TURNO ${destino.turno.slice(-1)}`;
}

/** Prioridad de las etiquetas al ordenar: el orden de las sugeridas; las propias después, sin etiqueta al final. */
const PRIORIDAD_DE_ETIQUETA: Record<string, number> = Object.fromEntries(ETIQUETAS_SUGERIDAS.map((e, i) => [e, i + 1]));

export function ordenarFilas(filas: FilaDeReporte[], orden: OrdenDeReporte = 'tipo'): FilaDeReporte[] {
  const porCodigo = (a: FilaDeReporte, b: FilaDeReporte) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true });
  const copia = [...filas];
  if (orden === 'etiqueta') {
    const prioridad = (f: FilaDeReporte) => (f.etiqueta ? (PRIORIDAD_DE_ETIQUETA[f.etiqueta] ?? 8) : 9);
    return copia.sort((a, b) => prioridad(a) - prioridad(b) || porCodigo(a, b));
  }
  if (orden === 'empresa') {
    return copia.sort((a, b) => (a.empresa ?? '￿').localeCompare(b.empresa ?? '￿', 'es') || porCodigo(a, b));
  }
  return copia.sort((a, b) => ORDEN_DE_TIPO[tipoDeCaso(a.codigo)] - ORDEN_DE_TIPO[tipoDeCaso(b.codigo)] || porCodigo(a, b));
}

const ORDEN_DE_TURNO: Record<TurnoTecnico, number> = { turnoA: 1, comodin: 2, turnoB: 3, turnoC: 4 };

/** Agrupa por receptor (orden: día, turno, nombre); los cerrados van en un bloque final. */
export function armarBloques(
  entradas: { destino: DestinoDeBloque | null; fila: FilaDeReporte }[],
  orden: OrdenDeReporte = 'tipo'
): BloqueDeReporte[] {
  const grupos = new Map<string, BloqueDeReporte>();
  for (const { destino, fila } of entradas) {
    const clave = destino ? `${destino.fecha}|${destino.nombre}` : 'cerrados';
    const grupo = grupos.get(clave) ?? { destino, filas: [] };
    grupo.filas.push(fila);
    grupos.set(clave, grupo);
  }
  const bloques = [...grupos.values()].map((b) => ({ ...b, filas: ordenarFilas(b.filas, orden) }));
  return bloques.sort((a, b) => {
    if (!a.destino || !b.destino) return a.destino ? -1 : b.destino ? 1 : 0;
    return (
      a.destino.fecha.localeCompare(b.destino.fecha) ||
      ORDEN_DE_TURNO[a.destino.turno] - ORDEN_DE_TURNO[b.destino.turno] ||
      a.destino.nombre.localeCompare(b.destino.nombre, 'es')
    );
  });
}

export function escaparHtml(texto: string | null | undefined): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ColorDeChip {
  fondo: string;
  texto: string;
  borde: string;
}

/** Colores del marco de la tabla (lo que cambia entre paletas). Fondo blanco: se lee bien en Outlook. */
export interface ColoresDelMarco {
  borde: string;
  barraFondo: string;
  barraTexto: string;
  barraTenue: string;
  rotulo: string;
  fechaFondo: string;
  fechaTexto: string;
  encabezadoFondo: string;
  encabezadoTexto: string;
  encabezadoBorde: string;
  filaAlterna: string;
  filaBorde: string;
  filaTexto: string;
  filaTenue: string;
  codigoTexto: string;
}

export interface TemaCorreo extends ColoresDelMarco {
  fuente: string;
  ancho: number;
  filaFondo: string;
  /** Chip de asignación de cada bloque (siempre el mismo color por turno, para reconocerlo). */
  turnos: Record<TurnoTecnico | 'cerrados', ColorDeChip>;
  etiquetas: Record<string, { fondo: string; texto: string }>;
}

export type IdPaletaCorreo = 'calido' | 'azul' | 'verde' | 'grafito' | 'morado' | 'vino';

/** Paletas que el técnico puede elegir para la tabla del traspaso (se recuerda en su navegador). */
export const PALETAS_CORREO: readonly { id: IdPaletaCorreo; nombre: string; muestra: string; marco: ColoresDelMarco }[] = [
  {
    id: 'calido',
    nombre: 'Cálido',
    muestra: '#FBE3C2',
    marco: {
      borde: '#E8D5BC', barraFondo: '#FBE3C2', barraTexto: '#5C2E0E', barraTenue: '#8A5A2B', rotulo: '#B4540A',
      fechaFondo: '#FFF4E3', fechaTexto: '#7A3E12', encabezadoFondo: '#FDEEDB', encabezadoTexto: '#6B3410',
      encabezadoBorde: '#F2B97A', filaAlterna: '#FFFAF3', filaBorde: '#F1E2CF', filaTexto: '#3F2A1A',
      filaTenue: '#7A6450', codigoTexto: '#8A3B0B'
    }
  },
  {
    id: 'azul',
    nombre: 'Azul',
    muestra: '#DCE8F6',
    marco: {
      borde: '#C9D8EA', barraFondo: '#DCE8F6', barraTexto: '#10304F', barraTenue: '#3F5F80', rotulo: '#1D5FA8',
      fechaFondo: '#EEF4FB', fechaTexto: '#1B3F66', encabezadoFondo: '#E5EEF8', encabezadoTexto: '#17375A',
      encabezadoBorde: '#8FB2DA', filaAlterna: '#F6F9FD', filaBorde: '#DFE8F2', filaTexto: '#1F2A37',
      filaTenue: '#5B6B7E', codigoTexto: '#1D4E89'
    }
  },
  {
    id: 'verde',
    nombre: 'Verde',
    muestra: '#DCEFE0',
    marco: {
      borde: '#CFE3D3', barraFondo: '#DCEFE0', barraTexto: '#173F22', barraTenue: '#3F6B49', rotulo: '#2E7D43',
      fechaFondo: '#F0F8F1', fechaTexto: '#1E4D2A', encabezadoFondo: '#E6F3E8', encabezadoTexto: '#1C4526',
      encabezadoBorde: '#93C79F', filaAlterna: '#F7FBF7', filaBorde: '#E0EDE2', filaTexto: '#22312A',
      filaTenue: '#5A6E60', codigoTexto: '#23683A'
    }
  },
  {
    id: 'grafito',
    nombre: 'Grafito',
    muestra: '#E4E7EB',
    marco: {
      borde: '#D5D9DE', barraFondo: '#E4E7EB', barraTexto: '#1F2933', barraTenue: '#52606D', rotulo: '#3E4C59',
      fechaFondo: '#F3F4F6', fechaTexto: '#323F4B', encabezadoFondo: '#ECEEF1', encabezadoTexto: '#283440',
      encabezadoBorde: '#AAB2BC', filaAlterna: '#F8F9FA', filaBorde: '#E4E7EB', filaTexto: '#1F2933',
      filaTenue: '#616E7C', codigoTexto: '#243B53'
    }
  },
  {
    id: 'morado',
    nombre: 'Morado',
    muestra: '#E8E0F7',
    marco: {
      borde: '#DCD3EE', barraFondo: '#E8E0F7', barraTexto: '#2E1A5E', barraTenue: '#5B4A86', rotulo: '#6B3FB5',
      fechaFondo: '#F5F1FC', fechaTexto: '#3D2A75', encabezadoFondo: '#EFE9FA', encabezadoTexto: '#34205F',
      encabezadoBorde: '#B49DE0', filaAlterna: '#FAF8FE', filaBorde: '#E9E3F5', filaTexto: '#2A2238',
      filaTenue: '#6A6080', codigoTexto: '#4F2C9A'
    }
  },
  {
    id: 'vino',
    nombre: 'Vino',
    muestra: '#F6DEE1',
    marco: {
      borde: '#EBCFD3', barraFondo: '#F6DEE1', barraTexto: '#5A1420', barraTenue: '#8A4250', rotulo: '#A3243A',
      fechaFondo: '#FCF1F2', fechaTexto: '#6E1C2A', encabezadoFondo: '#F9E8EA', encabezadoTexto: '#5E1824',
      encabezadoBorde: '#DE9AA5', filaAlterna: '#FEF8F9', filaBorde: '#F2E1E3', filaTexto: '#3A2226',
      filaTenue: '#7D5E63', codigoTexto: '#8C1D31'
    }
  }
];

export const PALETA_POR_DEFECTO: IdPaletaCorreo = 'calido';

export function esPaletaCorreo(valor: unknown): valor is IdPaletaCorreo {
  return PALETAS_CORREO.some((p) => p.id === valor);
}

/** Tema completo del correo con el marco de la paleta elegida (una desconocida usa la cálida). */
export function temaDeCorreo(paleta: string | null | undefined = PALETA_POR_DEFECTO): TemaCorreo {
  const marco = (PALETAS_CORREO.find((p) => p.id === paleta) ?? PALETAS_CORREO[0]!).marco;
  return {
    fuente: "Calibri, 'Segoe UI', Arial, sans-serif",
    ancho: 900,
    filaFondo: '#FFFFFF',
    ...marco,
    turnos: {
      turnoA: { fondo: '#FFEFB8', texto: '#7A4B03', borde: '#E6B422' },
      comodin: { fondo: '#DFF2D8', texto: '#2F5E1F', borde: '#8BC37A' },
      turnoB: { fondo: '#F9C99B', texto: '#6B2D08', borde: '#E08A3C' },
      turnoC: { fondo: '#E3DDF5', texto: '#3E2A7A', borde: '#9C8AD6' },
      cerrados: { fondo: '#ECECEC', texto: '#4A4A4A', borde: '#B8B8B8' }
    },
    etiquetas: {
      'Crítico': { fondo: '#FBD9D3', texto: '#8E2412' },
      'Escalar': { fondo: '#EADCF5', texto: '#5B2A86' },
      'VM': { fondo: '#D6ECF3', texto: '#14536A' },
      'Monitoreo': { fondo: '#DCEBF5', texto: '#1F5A7A' },
      'Pendiente cliente': { fondo: '#FFE9B0', texto: '#7A4B03' },
      'Seguimiento': { fondo: '#E2F0E4', texto: '#2F5E35' },
      otra: { fondo: '#EFE7DC', texto: '#5C4630' }
    }
  };
}

/** Paleta cálida (la de siempre). Se mantiene por compatibilidad. */
export const TEMA_CORREO: TemaCorreo = temaDeCorreo(PALETA_POR_DEFECTO);

type Tema = TemaCorreo;

/** Texto de la celda Detalle: [ETIQUETA] descripción · última actualización · recordatorio. */
function partesDelDetalle(fila: FilaDeReporte) {
  return {
    descripcion: fila.descripcion?.trim() || null,
    actualizacion: fila.ultimaActualizacionEn ? momentoCorto(fila.ultimaActualizacionEn) || null : null,
    recordatorio: fila.recordatorioFecha
      ? `Recordatorio ${fechaCorta(fila.recordatorioFecha)}${fila.recordatorioTexto?.trim() ? `: ${fila.recordatorioTexto.trim()}` : ''}`
      : null
  };
}

function chipDeEtiqueta(etiqueta: string | null, tema: Tema): string {
  if (!etiqueta) return '';
  const color = tema.etiquetas[etiqueta] ?? tema.etiquetas.otra!;
  return `<span style="background-color:${color.fondo};color:${color.texto};font-size:8.5pt;font-weight:bold;padding:1px 6px;">${escaparHtml(etiqueta)}</span>&nbsp; `;
}

function bloqueHtml(bloque: BloqueDeReporte, esUltimo: boolean, tema: Tema, conEtiquetas: boolean): string {
  const t = tema;
  const turno = bloque.destino ? t.turnos[bloque.destino.turno] : t.turnos.cerrados;
  const titulo = bloque.destino ? bloque.destino.nombre : 'Casos cerrados';
  const cantidad = `${bloque.filas.length} ${bloque.filas.length === 1 ? 'caso' : 'casos'}`;
  const celda = `padding:8px 12px;border-bottom:1px solid ${t.filaBorde};vertical-align:top;`;
  const th = (texto: string, ancho: string, ultimo = false) =>
    `<th bgcolor="${t.encabezadoFondo}" width="${ancho}" align="left" style="background-color:${t.encabezadoFondo};color:${t.encabezadoTexto};font-weight:bold;font-size:9.5pt;text-align:left;padding:7px 12px;border-bottom:2px solid ${t.encabezadoBorde};${ultimo ? '' : `border-right:1px solid ${t.filaBorde};`}">${texto}</th>`;

  const filas = bloque.filas
    .map((f, i) => {
      const fondo = i % 2 === 1 ? t.filaAlterna : t.filaFondo;
      const td = (contenido: string, extra = '', ultimo = false) =>
        `<td bgcolor="${fondo}" style="background-color:${fondo};${celda}${ultimo ? '' : `border-right:1px solid ${t.filaBorde};`}${extra}">${contenido}</td>`;
      const detalle = partesDelDetalle(f);
      const lineas = [
        `${conEtiquetas ? chipDeEtiqueta(f.etiqueta, t) : ''}${escaparHtml(detalle.descripcion ?? '')}`,
        detalle.actualizacion ? `<span style="color:${t.filaTenue};">Últ. act.: ${escaparHtml(detalle.actualizacion)}</span>` : '',
        detalle.recordatorio ? `<span style="color:${t.rotulo};font-weight:bold;">${escaparHtml(detalle.recordatorio)}</span>` : ''
      ].filter((l) => l.trim() !== '');
      return `<tr>
${td(`<span style="font-family:Consolas,'Courier New',monospace;font-weight:bold;color:${t.codigoTexto};font-size:10pt;">${escaparHtml(f.codigo)}</span>`, 'white-space:nowrap;')}
${td(escaparHtml(f.empresa ?? ''), `font-weight:bold;color:${t.filaTexto};`)}
${td(escaparHtml(f.area ?? ''), `color:${t.filaTenue};`)}
${td(escaparHtml(ETIQUETA_ESTADO_CASO[f.estado]), `color:${t.filaTexto};white-space:nowrap;`)}
${td(lineas.join('<br>'), `color:${t.filaTexto};line-height:1.35;`, true)}
</tr>`;
    })
    .join('\n');

  const fecha = bloque.destino
    ? `<tr>
<td colspan="5" bgcolor="${t.fechaFondo}" style="background-color:${t.fechaFondo};padding:6px 12px;border-bottom:1px solid ${t.borde};"><span style="color:${t.rotulo};font-weight:bold;font-size:9pt;">FECHA&nbsp;&nbsp;</span><span style="color:${t.fechaTexto};font-weight:bold;font-size:10pt;">${escaparHtml(fechaEnTexto(bloque.destino.fecha))}</span></td>
</tr>`
    : '';

  return `<table width="${t.ancho}" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:${t.ancho}px;font-family:${t.fuente};font-size:10.5pt;border:1px solid ${t.borde};">
<tr>
<td colspan="4" bgcolor="${t.barraFondo}" style="background-color:${t.barraFondo};padding:10px 12px;border-bottom:1px solid ${t.borde};"><span style="color:${t.rotulo};font-weight:bold;font-size:8.5pt;letter-spacing:0.6px;">TÉCNICO&nbsp;&nbsp;</span><span style="color:${t.barraTexto};font-weight:bold;font-size:12pt;">${escaparHtml(titulo)}</span>&nbsp;&nbsp;<span style="color:${t.barraTenue};font-size:9.5pt;">(${cantidad})</span></td>
<td bgcolor="${t.barraFondo}" align="right" style="background-color:${t.barraFondo};padding:10px 12px;border-bottom:1px solid ${t.borde};text-align:right;"><span style="background-color:${turno.fondo};color:${turno.texto};border:1px solid ${turno.borde};font-weight:bold;font-size:9.5pt;padding:3px 10px;">${escaparHtml(asignacionEnTexto(bloque.destino))}</span></td>
</tr>
${fecha}
<tr>
${th('Incidente', '15%')}${th('Empresa', '18%')}${th('Área', '12%')}${th('Estado', '10%')}${th('Detalle', '45%', true)}
</tr>
${filas}
</table>${esUltimo ? '' : '<p style="margin:0;line-height:16px;font-size:8pt;">&nbsp;</p>'}`;
}

/** Tabla HTML lista para pegar en Outlook. */
export function reporteHtml(bloques: BloqueDeReporte[], { conEtiquetas = true, tema = TEMA_CORREO } = {}): string {
  if (bloques.length === 0) return '';
  const cuerpo = bloques.map((b, i) => bloqueHtml(b, i === bloques.length - 1, tema, conEtiquetas)).join('\n');
  return `<div style="font-family:${tema.fuente};font-size:11pt;color:${tema.filaTexto};">\n${cuerpo}\n</div>`;
}

function detalleEnTexto(fila: FilaDeReporte, conEtiquetas: boolean): string {
  const d = partesDelDetalle(fila);
  const etiqueta = conEtiquetas && fila.etiqueta ? `[${fila.etiqueta.toUpperCase()}] ` : '';
  return [`${etiqueta}${d.descripcion ?? ''}`.trim(), d.actualizacion ? `Últ. act.: ${d.actualizacion}` : '', d.recordatorio ?? '']
    .filter(Boolean)
    .join(' · ');
}

/** Texto plano para chat o correo sin formato. */
export function reporteTexto(bloques: BloqueDeReporte[], { conEtiquetas = true } = {}): string {
  return bloques
    .map((b) => {
      const encabezado = b.destino
        ? `${b.destino.nombre} · ${asignacionEnTexto(b.destino)} · ${fechaEnTexto(b.destino.fecha)}`
        : asignacionEnTexto(null);
      const lineas = b.filas.map((f) =>
        `- ${[f.codigo, f.empresa, f.area, ETIQUETA_ESTADO_CASO[f.estado], detalleEnTexto(f, conEtiquetas)].filter((p) => p && p.trim()).join(' · ')}`
      );
      return [encabezado, ...lineas].join('\n');
    })
    .join('\n\n');
}

/** Sin tabuladores ni saltos de línea dentro de una celda del TSV. */
const celdaTsv = (texto: string | null | undefined) => String(texto ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** TSV para pegar en Excel: encabezado por técnico y una fila por caso. */
export function reporteTsv(bloques: BloqueDeReporte[], { conEtiquetas = true } = {}): string {
  const filas: string[][] = [];
  for (const b of bloques) {
    filas.push(['TECNICO:', b.destino?.nombre ?? 'Casos cerrados', 'ASIGNACION:', asignacionEnTexto(b.destino), '', '']);
    filas.push(['FECHA:', b.destino ? fechaEnTexto(b.destino.fecha) : '', '', '', '', '']);
    filas.push(['Incidente', 'Empresa', 'Area', 'Estado', 'Descripcion', 'Ultima actualizacion']);
    for (const f of b.filas) {
      const d = partesDelDetalle(f);
      const etiqueta = conEtiquetas && f.etiqueta ? `[${f.etiqueta.toUpperCase()}] ` : '';
      const descripcion = [`${etiqueta}${d.descripcion ?? ''}`.trim(), d.recordatorio ?? ''].filter(Boolean).join(' · ');
      filas.push([f.codigo, f.empresa ?? '', f.area ?? '', ETIQUETA_ESTADO_CASO[f.estado], descripcion, d.actualizacion ?? '']);
    }
    filas.push(['', '', '', '', '', '']);
  }
  return filas.map((f) => f.map(celdaTsv).join('\t')).join('\n');
}
