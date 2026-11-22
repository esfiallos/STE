/**
 * Pestaña "Buscar casos" (coordinación y dispatch): todos los casos alguna vez creados, con su ficha
 * (responsables y traspasos). Solo lectura.
 */
import { ETIQUETA_ORIGEN } from '../../domain/followUp';
import { ETIQUETA_ESTADO_CASO } from '../../domain/handover';
import { fechaCorta } from '../../domain/handoverReport';
import { listarResponsables } from '../../services/casosRepo';
import { buscarCasos } from '../../services/coordinacionRepo';
import { listarTraspasosDelCaso } from '../../services/traspasosRepo';
import { appStore } from '../../state/appStore';
import type { CasoEncontrado } from '../../types/noc';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { formatearFechaCorta, formatearFechaHora } from '../ui/format';
import { animarLista } from '../ui/animacion';

let consulta = 0;
let resultados: CasoEncontrado[] = [];

const nombreDe = (id: string | null) => (id ? (appStore.get().catalogo.find((t) => t.id === id)?.nombre ?? 'Técnico') : 'Sin receptor');
const oGuion = (texto: string | null | undefined) => (texto?.trim() ? texto : '—');

function pintarEstado(texto: string | null, esError = false): void {
  const estado = byId('caseSearchStatus');
  estado.textContent = texto ?? '';
  estado.classList.toggle('hidden', !texto);
  estado.classList.toggle('form-error', esError);
}

function crearResultado(caso: CasoEncontrado): HTMLElement {
  const fragmento = clonarPlantilla('tpl-caso-encontrado');
  const tarjeta = ref(fragmento, 'tarjeta');
  tarjeta.dataset.casoId = caso.id;
  tarjeta.dataset.estado = caso.estado;

  ref(fragmento, 'codigo').textContent = caso.codigo;
  ref(fragmento, 'estado').textContent = ETIQUETA_ESTADO_CASO[caso.estado];
  if (caso.etiqueta) {
    const etiqueta = ref(fragmento, 'etiqueta');
    etiqueta.textContent = caso.etiqueta;
    etiqueta.classList.remove('hidden');
  }
  if (caso.recordatorioFecha) {
    const recordatorio = ref(fragmento, 'recordatorio');
    recordatorio.textContent = `Recordatorio ${fechaCorta(caso.recordatorioFecha)}${caso.recordatorioTexto ? `: ${caso.recordatorioTexto}` : ''}`;
    recordatorio.classList.remove('hidden');
  }

  ref(fragmento, 'responsable').textContent = caso.estado === 'cerrado' ? `${oGuion(caso.tecnicoActual)} (cerrado)` : oGuion(caso.tecnicoActual);
  ref(fragmento, 'empresa').textContent = oGuion(caso.cliente);
  ref(fragmento, 'area').textContent = oGuion(caso.area);
  ref(fragmento, 'nota').textContent = oGuion(caso.descripcion ?? caso.nota);
  ref(fragmento, 'actualizacion').textContent = caso.ultimaActualizacion
    ? `${caso.ultimaActualizacion}${caso.ultimaActualizacionEn ? ` · ${formatearFechaHora(caso.ultimaActualizacionEn)}` : ''}${caso.ultimaActualizacionPor ? ` · ${caso.ultimaActualizacionPor}` : ''}`
    : '—';
  ref(fragmento, 'creado').textContent = `${formatearFechaHora(caso.creadoEn)}${caso.creadoPor ? ` · ${caso.creadoPor}` : ''}`;
  ref(fragmento, 'actividad').textContent = caso.actividadTecnicoEn ? formatearFechaHora(caso.actividadTecnicoEn) : '—';
  ref(fragmento, 'cerrado').textContent = caso.cerradoEn ? `Cerrado ${formatearFechaHora(caso.cerradoEn)}` : '';
  return tarjeta;
}

async function cargarFicha(tarjeta: HTMLElement, casoId: string): Promise<void> {
  const responsables = ref(tarjeta, 'responsables');
  const traspasos = ref(tarjeta, 'traspasos');
  responsables.replaceChildren(crearElemento('li', 'text-muted', 'Cargando…'));
  traspasos.replaceChildren();

  const [historial, viajes] = await Promise.all([listarResponsables(casoId), listarTraspasosDelCaso(casoId)]);
  responsables.replaceChildren(
    ...(!historial.ok
      ? [crearElemento('li', 'form-error', historial.error)]
      : historial.data.length === 0
        ? [crearElemento('li', '', 'Nunca tuvo responsable.')]
        : historial.data.map((r) =>
            crearElemento(
              'li',
              r.hasta ? '' : 'is-actual',
              `${r.tecnicoNombre} · ${ETIQUETA_ORIGEN[r.origen]} · ${formatearFechaHora(r.desde)}${r.hasta ? ` → ${formatearFechaHora(r.hasta)}` : ' (actual)'}`
            )
          ))
  );
  traspasos.replaceChildren(
    ...(!viajes.ok
      ? [crearElemento('li', 'form-error', viajes.error)]
      : viajes.data.length === 0
        ? [crearElemento('li', '', 'No pasó por ningún traspaso.')]
        : viajes.data.map((t) =>
            crearElemento(
              'li',
              '',
              [
                `${formatearFechaCorta(t.fecha)}: ${nombreDe(t.deTecnicoId)} → ${t.estado === 'cerrado' ? 'lo cerró' : nombreDe(t.paraTecnicoId)}`,
                ETIQUETA_ESTADO_CASO[t.estado],
                t.etiqueta ? `[${t.etiqueta}]` : '',
                t.notaPersonalizada ? `Nota: ${t.notaPersonalizada}` : '',
                t.ultimaActualizacion ? `Últ. act.: ${t.ultimaActualizacion}` : ''
              ]
                .filter(Boolean)
                .join(' · ')
            )
          ))
  );
}

/** Busca y dibuja los resultados. También la usa el panel de coordinación para abrir el caso de una alerta. */
export async function buscarCaso(termino: string): Promise<void> {
  const texto = termino.trim();
  byId<HTMLInputElement>('caseSearchInput').value = texto;
  if (!texto) return;
  const numero = ++consulta;
  pintarEstado('Buscando…');
  const resultado = await buscarCasos(texto);
  if (numero !== consulta) return;
  if (!resultado.ok) {
    pintarEstado(resultado.error, true);
    return;
  }
  resultados = resultado.data;
  pintarEstado(
    resultados.length === 0
      ? `No hay casos que coincidan con "${texto}".`
      : resultados.length >= 50
        ? `Se muestran los primeros ${resultados.length}: afina la búsqueda para ver otros.`
        : null
  );
  const contenedor = byId('caseSearchResults');
  animarLista(contenedor);
  contenedor.replaceChildren(...resultados.map(crearResultado));
  // Si hay un único resultado, se abre su ficha
  if (resultados.length === 1) {
    const tarjeta = byId('caseSearchResults').querySelector<HTMLElement>('[data-caso-id]')!;
    abrirFicha(tarjeta, resultados[0]!.id);
  }
}

function abrirFicha(tarjeta: HTMLElement, casoId: string): void {
  const ficha = ref(tarjeta, 'ficha');
  const boton = tarjeta.querySelector<HTMLElement>('[data-action="ver-ficha"]')!;
  const abrir = ficha.classList.contains('hidden');
  ficha.classList.toggle('hidden', !abrir);
  boton.setAttribute('aria-expanded', String(abrir));
  if (abrir) void cargarFicha(tarjeta, casoId);
}

export function iniciarBuscadorDeCasos(): void {
  byId('caseSearchForm').addEventListener('submit', (evento) => {
    evento.preventDefault();
    void buscarCaso(byId<HTMLInputElement>('caseSearchInput').value);
  });
  byId('caseSearchResults').addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-action="ver-ficha"]') : null;
    const tarjeta = boton?.closest<HTMLElement>('[data-caso-id]');
    if (boton && tarjeta?.dataset.casoId) abrirFicha(tarjeta, tarjeta.dataset.casoId);
  });
}
