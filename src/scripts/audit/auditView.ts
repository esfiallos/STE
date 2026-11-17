import { describirAccion } from '../../domain/audit';
import { normalizarBusqueda } from '../../domain/search';
import { listarBitacora } from '../../services/bitacoraRepo';
import type { EntradaBitacora } from '../../types/noc';
import { byId } from '../dom';
import { avisarSiFalla } from '../ui/toast';
import { crearTablaBitacora } from './auditTable';

let entradas: EntradaBitacora[] = [];

function coincide(entrada: EntradaBitacora, termino: string): boolean {
  const texto = [entrada.usuario, describirAccion(entrada.accion), entrada.codigo, entrada.tecnico, entrada.detalle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return texto.includes(termino);
}

function pintar(): void {
  const termino = normalizarBusqueda(byId<HTMLInputElement>('auditFilter').value);
  const visibles = termino ? entradas.filter((e) => coincide(e, termino)) : entradas;

  byId('auditCount').textContent = `${visibles.length} registro(s)`;
  byId('auditTable').replaceChildren(
    crearTablaBitacora(visibles, termino ? 'Sin coincidencias.' : 'Aún no hay movimientos registrados.')
  );
}

/** Lee la bitácora más reciente. Se llama cada vez que se abre la pestaña. */
export async function cargarBitacora(): Promise<void> {
  const resultado = await listarBitacora();
  if (!avisarSiFalla(resultado)) return;

  entradas = resultado.data;
  pintar();
}

export function iniciarBitacora(): void {
  byId('auditFilter').addEventListener('input', pintar);
  byId('btnAuditRefresh').addEventListener('click', () => void cargarBitacora());
}
