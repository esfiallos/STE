/**
 * Pestaña "Mis traspasos": lo que el técnico entregó y recibió en un día operativo, con el reporte
 * listo para volver a copiar. Solo lectura.
 */
import { entradasDelReporte } from '../../domain/handoverDraft';
import { armarBloques, fechaCorta, reporteHtml, reporteTexto, reporteTsv, type DestinoDeBloque } from '../../domain/handoverReport';
import { ETIQUETA_ESTADO_CASO } from '../../domain/handover';
import { nombreDeTurno } from '../../domain/shifts';
import { fechaOperativa, sumarDias } from '../../domain/time';
import { listarJornadas } from '../../services/jornadasRepo';
import { listarEnviados, listarRecibidos } from '../../services/traspasosRepo';
import { appStore } from '../../state/appStore';
import type { ItemTraspasoEnviado, TraspasoEnviado } from '../../types/noc';
import { copiarReporte, type FormatoDeCopia } from '../actions/handoverActions';
import { byId } from '../dom';
import { formatearFechaHora } from '../ui/format';
import { crearTabla } from '../ui/table';
import { mejorarCampoDeFecha } from '../ui/fecha';

let tecnicoId = '';
let consulta = 0;
let salidas = { html: '', texto: '', tsv: '' };

const nombreDe = (id: string | null) => (id ? (appStore.get().catalogo.find((t) => t.id === id)?.nombre ?? 'Técnico') : '');

const recordatorio = (i: ItemTraspasoEnviado) =>
  i.recordatorioFecha ? `${fechaCorta(i.recordatorioFecha)}${i.recordatorioTexto ? ` · ${i.recordatorioTexto}` : ''}` : '';

const etiquetaYNota = (i: ItemTraspasoEnviado) => [i.etiqueta ? `[${i.etiqueta}]` : '', i.notaPersonalizada ?? i.nota ?? ''].filter(Boolean).join(' ');

function pintarEstado(texto: string | null, esError = false): void {
  const estado = byId('myHandoversStatus');
  estado.textContent = texto ?? '';
  estado.classList.toggle('hidden', !texto);
  estado.classList.toggle('form-error', esError);
}

/** Lee y dibuja lo enviado y lo recibido el día elegido. */
export async function cargarMisTraspasos(): Promise<void> {
  if (!tecnicoId) return;
  const campo = byId<HTMLInputElement>('myHandoversDate');
  if (!campo.value) campo.value = appStore.get().fechaOperativa || fechaOperativa(new Date());
  campo.max = appStore.get().fechaOperativa || fechaOperativa(new Date());
  mejorarCampoDeFecha(campo, { direccion: 'pasado' });
  const fecha = campo.value;
  const numero = ++consulta;
  pintarEstado('Cargando…');

  const [enviados, recibidos, jornadas] = await Promise.all([
    listarEnviados(tecnicoId, fecha),
    listarRecibidos(tecnicoId, fecha),
    listarJornadas(fecha, sumarDias(fecha, 1))
  ]);
  if (numero !== consulta) return;
  if (!enviados.ok || !recibidos.ok || !jornadas.ok) {
    pintarEstado([enviados, recibidos, jornadas].map((r) => (r.ok ? '' : r.error)).find(Boolean) ?? 'No se pudo cargar.', true);
    return;
  }
  pintarEstado(null);
  pintarEnviados(enviados.data, (id, fechaDestino) => {
    const j = jornadas.data.find((x) => x.tecnicoId === id && x.fecha === fechaDestino);
    return j ? { nombre: nombreDe(id), turno: j.turno, fecha: fechaDestino, horarioInicio: j.horarioInicio, horarioFin: j.horarioFin } : null;
  });
  pintarRecibidos(recibidos.data);
}

function pintarEnviados(traspasos: TraspasoEnviado[], destinoDe: (id: string, fecha: string) => DestinoDeBloque | null): void {
  const t = traspasos[0];
  const items = t?.items ?? [];
  byId('mySentMeta').textContent = t
    ? `Enviado ${t.enviadoEn ? formatearFechaHora(t.enviadoEn) : ''}${t.turnoOrigen ? ` · desde ${nombreDeTurno(t.turnoOrigen)}` : ''} · ${items.length} caso(s)`
    : '';

  byId('mySent').replaceChildren(
    crearTabla(
      ['Caso', 'Empresa', 'Área', 'Estado', 'Entregado a', 'Detalle', 'Última actualización', 'Recordatorio'],
      [...items]
        .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
        .map((i) => [
          i.codigo,
          i.cliente ?? '',
          i.area ?? '',
          ETIQUETA_ESTADO_CASO[i.estado],
          i.estado === 'cerrado' ? 'Cerrado en el turno' : nombreDe(i.paraTecnicoId),
          etiquetaYNota(i),
          i.ultimaActualizacion ?? '',
          recordatorio(i)
        ]),
      'No enviaste traspaso este día.'
    )
  );

  const destinos = new Map<string, DestinoDeBloque>();
  for (const i of items) {
    if (!i.paraTecnicoId || !i.fechaDestino) continue;
    const destino = destinoDe(i.paraTecnicoId, i.fechaDestino) ?? { nombre: nombreDe(i.paraTecnicoId), turno: 'turnoA', fecha: i.fechaDestino };
    destinos.set(i.paraTecnicoId, destino);
  }
  const casos = items.map((i) => ({ id: i.casoId, codigo: i.codigo, cliente: i.cliente, area: i.area, nota: i.nota }));
  const bloques = armarBloques(entradasDelReporte(items, casos, destinos));
  salidas = { html: reporteHtml(bloques), texto: reporteTexto(bloques), tsv: reporteTsv(bloques) };
  byId('myHandoversCopy').classList.toggle('hidden', items.length === 0);
}

function pintarRecibidos(traspasos: TraspasoEnviado[]): void {
  const filas = traspasos.flatMap((t) =>
    t.items.map((i) => [
      i.codigo,
      nombreDe(t.deTecnicoId),
      i.cliente ?? '',
      i.area ?? '',
      ETIQUETA_ESTADO_CASO[i.estado],
      etiquetaYNota(i),
      i.ultimaActualizacion ?? '',
      recordatorio(i)
    ])
  );
  byId('myReceived').replaceChildren(
    crearTabla(['Caso', 'De', 'Empresa', 'Área', 'Estado', 'Detalle', 'Última actualización', 'Recordatorio'], filas, 'No recibiste casos en traspaso para este día.')
  );
}

export function iniciarMisTraspasos(miTecnicoId: string): void {
  tecnicoId = miTecnicoId;
  byId('myHandoversDate').addEventListener('change', () => void cargarMisTraspasos());
  byId('myHandoversCopy')
    .querySelectorAll<HTMLElement>('[data-copiar]')
    .forEach((boton) => boton.addEventListener('click', () => void copiarReporte(boton.dataset.copiar as FormatoDeCopia, salidas)));
}
