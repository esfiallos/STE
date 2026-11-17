import { buscarEnBitacora } from '../../services/bitacoraRepo';
import { buscarEnHistorial, listarFechasDeSnapshots, obtenerSnapshot } from '../../services/historialRepo';
import type { CoincidenciaHistorial } from '../../types/noc';
import type { Resultado } from '../../types/result';
import { copiarCodigo } from '../actions/incidentActions';
import { crearTablaBitacora } from '../audit/auditTable';
import { byId, crearElemento } from '../dom';
import { formatearFechaCorta, formatearFechaLarga } from '../ui/format';
import { crearTabla } from '../ui/table';
import { avisarSiFalla } from '../ui/toast';
import { nombreDeTurno } from '../../domain/shifts';
import { renderizarSnapshot } from './snapshotBoard';

async function mostrarDia(fecha: string): Promise<void> {
  const resultado = await obtenerSnapshot(fecha);
  if (!avisarSiFalla(resultado)) return;
  renderizarSnapshot(byId('historyBoard'), resultado.data);
}

/** Lee los días con snapshot y muestra el más reciente (o el que ya estaba elegido). Se llama al abrir la pestaña. */
export async function cargarHistorial(): Promise<void> {
  const resultado = await listarFechasDeSnapshots();
  if (!avisarSiFalla(resultado)) return;

  const selector = byId<HTMLSelectElement>('historyDate');
  const anterior = selector.value;
  const fechas = resultado.data;

  byId('historyEmpty').classList.toggle('hidden', fechas.length > 0);
  byId('historyBoardArea').classList.toggle('hidden', fechas.length === 0);

  selector.replaceChildren(...fechas.map((fecha) => new Option(formatearFechaLarga(fecha), fecha)));
  if (fechas.includes(anterior)) selector.value = anterior;

  if (selector.value) await mostrarDia(selector.value);
}

function crearSeccion(titulo: string, contenido: HTMLElement): HTMLElement {
  const seccion = crearElemento('section', 'results-block');
  seccion.append(crearElemento('h3', '', titulo), contenido);
  return seccion;
}

function tablaDeCoincidencias(resultado: Resultado<CoincidenciaHistorial[]>): HTMLElement {
  if (!resultado.ok) return crearElemento('p', 'table-empty', resultado.error);

  const filas = resultado.data.map((c) => [
    formatearFechaCorta(c.fecha),
    c.codigo,
    c.tecnico,
    nombreDeTurno(c.turno),
    c.nota ?? ''
  ]);
  return crearTabla(['Día', 'Caso', 'Técnico', 'Turno', 'Comentario'], filas, 'Ningún snapshot contiene ese texto.');
}

async function buscar(termino: string): Promise<void> {
  const resultados = byId('historyResults');
  resultados.replaceChildren(crearElemento('p', 'table-empty', 'Buscando…'));

  const [enSnapshots, enBitacora] = await Promise.all([buscarEnHistorial(termino), buscarEnBitacora(termino)]);

  const movimientos = enBitacora.ok
    ? crearTablaBitacora(enBitacora.data, 'No hay movimientos registrados con ese texto.')
    : crearElemento('p', 'table-empty', enBitacora.error);

  resultados.replaceChildren(
    crearSeccion('Estaba en el tablero al cierre del día', tablaDeCoincidencias(enSnapshots)),
    crearSeccion('Movimientos registrados (incluye casos cerrados durante el día)', movimientos)
  );
}

export function iniciarHistorial(): void {
  const selector = byId<HTMLSelectElement>('historyDate');
  selector.addEventListener('change', () => void mostrarDia(selector.value));

  byId('historySearchForm').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const termino = byId<HTMLInputElement>('historySearchInput').value.trim();
    if (termino) void buscar(termino);
  });

  // La foto de un día es de solo lectura, pero se puede plegar un turno y copiar un número.
  byId('historyBoard').addEventListener('click', (evento) => {
    if (!(evento.target instanceof Element)) return;
    const boton = evento.target.closest<HTMLElement>('[data-action]');
    if (!boton) return;

    if (boton.dataset.action === 'alternar-turno') {
      const seccion = boton.closest('.noc-accordion-card');
      const colapsada = seccion?.classList.toggle('is-collapsed') ?? false;
      boton.setAttribute('aria-expanded', String(!colapsada));
    }

    if (boton.dataset.action === 'copiar-codigo') {
      const codigo = boton.closest('.incident-item-card')?.querySelector('.inc-code')?.textContent;
      if (codigo) void copiarCodigo(codigo);
    }
  });
}
