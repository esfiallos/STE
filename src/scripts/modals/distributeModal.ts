import { casosHastaElDia, casosPorReasignar } from '../../domain/assignments';
import { gruposDeReceptores, type GrupoDeReceptores } from '../../domain/handoverDraft';
import { receptoresParaEntregar, repartirEntrega, type Entrega } from '../../domain/supervisionHandover';
import { sumarDias } from '../../domain/time';
import { listarJornadas } from '../../services/jornadasRepo';
import { appStore } from '../../state/appStore';
import type { Incidente } from '../../types/noc';
import { entregarCasosPorSupervision } from '../actions/incidentActions';
import { byId, crearElemento } from '../dom';
import { abrirModal, cerrarModal, establecerError } from './modal';

/**
 * Repartir los casos "por reasignar" (D37). Tres decisiones y nada más: qué casos (todos marcados), qué turno los
 * recibe y entre quiénes (todos los de ese turno marcados). El reparto es parejo y se ve antes de entregar.
 */
const MODAL = 'modalDistribute';

let casos: Incidente[] = [];
let grupos: GrupoDeReceptores[] = [];
const elegidos = new Set<string>();
const fuera = new Set<string>();

function casosPendientes(): Incidente[] {
  const { casosAbiertos, fechaOperativa, tecnicos } = appStore.get();
  return casosPorReasignar(casosHastaElDia(casosAbiertos, fechaOperativa), tecnicos);
}

const grupoActual = () => grupos.find((g) => g.clave === byId<HTMLSelectElement>('distributeShift').value) ?? null;

function entregas(): Entrega[] {
  const grupo = grupoActual();
  if (!grupo) return [];
  return repartirEntrega(
    casos.filter((c) => elegidos.has(c.id)),
    grupo.receptores.filter((r) => !fuera.has(r.tecnicoId))
  );
}

function pintar(): void {
  const nombres = new Map(appStore.get().catalogo.map((t) => [t.id, t.nombre]));

  byId('distributeCases').replaceChildren(
    ...casos.map((c) => {
      const etiqueta = crearElemento('label', 'distribute__case');
      const casilla = document.createElement('input');
      casilla.type = 'checkbox';
      casilla.checked = elegidos.has(c.id);
      casilla.dataset.caso = c.id;
      const de = c.tecnicoId ? `de ${nombres.get(c.tecnicoId) ?? '?'}` : 'sin responsable';
      etiqueta.append(casilla, crearElemento('span', 'font-mono', c.codigo), crearElemento('span', 'text-muted', [c.cliente, de].filter(Boolean).join(' · ')));
      return etiqueta;
    })
  );
  byId('distributeToggleAll').textContent = elegidos.size === casos.length ? 'Quitar todos' : 'Marcar todos';

  const grupo = grupoActual();
  byId('distributeTechs').replaceChildren(
    ...(grupo?.receptores ?? []).map((r) => {
      const etiqueta = crearElemento('label', 'handover-receiver');
      const casilla = document.createElement('input');
      casilla.type = 'checkbox';
      casilla.checked = !fuera.has(r.tecnicoId);
      casilla.dataset.tecnico = r.tecnicoId;
      etiqueta.append(casilla, crearElemento('span', '', r.nombre));
      return etiqueta;
    })
  );

  const lista = entregas();
  const porTecnico = new Map<string, string[]>();
  for (const e of lista) porTecnico.set(e.tecnicoId, [...(porTecnico.get(e.tecnicoId) ?? []), casos.find((c) => c.id === e.casoId)?.codigo ?? '?']);
  byId('distributePreview').replaceChildren(
    ...(porTecnico.size > 0
      ? [...porTecnico].map(([id, codigos]) => {
          const item = crearElemento('li', '');
          item.append(crearElemento('strong', '', `${nombres.get(id) ?? '?'} (${codigos.length})`), document.createTextNode(`: ${codigos.join(', ')}`));
          return item;
        })
      : [crearElemento('li', 'text-muted', 'Elige al menos un caso y una persona.')])
  );

  const boton = byId<HTMLButtonElement>('distributeSubmit');
  boton.textContent = `Entregar ${lista.length} caso(s)`;
  boton.disabled = lista.length === 0;
}

/** Abre el reparto con todos los casos "por reasignar" marcados y el primer turno que todavía puede recibir. */
export async function abrirReparto(): Promise<void> {
  const { fechaOperativa, catalogo, perfil } = appStore.get();
  if (perfil?.rol !== 'dispatch' && perfil?.rol !== 'coordinador') return;
  casos = casosPendientes();
  if (casos.length === 0) return;

  establecerError('distributeError', null);
  const jornadas = await listarJornadas(fechaOperativa, sumarDias(fechaOperativa, 1));
  if (!jornadas.ok) {
    establecerError('distributeError', jornadas.error);
    grupos = [];
  } else {
    grupos = gruposDeReceptores(receptoresParaEntregar(jornadas.data, catalogo, fechaOperativa, new Date()), fechaOperativa);
    if (grupos.length === 0) establecerError('distributeError', 'Nadie más puede recibir hoy ni mañana: revisa la planificación.');
  }

  elegidos.clear();
  casos.forEach((c) => elegidos.add(c.id));
  fuera.clear();
  const turno = byId<HTMLSelectElement>('distributeShift');
  turno.replaceChildren(...grupos.map((g) => new Option(`${g.etiqueta} (${g.receptores.length})`, g.clave)));
  turno.value = grupos[0]?.clave ?? '';
  pintar();
  abrirModal(MODAL);
}

export function iniciarModalReparto(): void {
  // El botón vive en la franja "Por reasignar", que se redibuja: se escucha en su contenedor
  byId('shiftsAccordionContainer').addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest('[data-action="repartir-por-reasignar"]') : null;
    if (boton) void abrirReparto();
  });

  byId('distributeCases').addEventListener('change', (evento) => {
    const casilla = evento.target;
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.caso) return;
    if (casilla.checked) elegidos.add(casilla.dataset.caso);
    else elegidos.delete(casilla.dataset.caso);
    pintar();
  });
  byId('distributeToggleAll').addEventListener('click', () => {
    if (elegidos.size === casos.length) elegidos.clear();
    else casos.forEach((c) => elegidos.add(c.id));
    pintar();
  });
  byId('distributeShift').addEventListener('change', () => {
    fuera.clear(); // otro turno: entran todos los de ese turno
    pintar();
  });
  byId('distributeTechs').addEventListener('change', (evento) => {
    const casilla = evento.target;
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.tecnico) return;
    if (casilla.checked) fuera.delete(casilla.dataset.tecnico);
    else fuera.add(casilla.dataset.tecnico);
    pintar();
  });

  byId<HTMLFormElement>('formDistribute').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const lista = entregas();
    if (lista.length === 0) return;
    const boton = byId<HTMLButtonElement>('distributeSubmit');
    boton.disabled = true;
    const resultado = await entregarCasosPorSupervision(lista);
    boton.disabled = false;
    if (resultado.ok) cerrarModal(MODAL);
    else establecerError('distributeError', resultado.error);
  });
}
