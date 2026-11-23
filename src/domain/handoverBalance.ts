/**
 * Reparto de los casos del traspaso entre los receptores (portado de traspasos-noc/services/balancer.js).
 *
 * Dos modos:
 *  - 'huerfanos': solo reparte los casos sin receptor válido; NO toca lo ya asignado.
 *  - 'todos':     reequilibra todo lo que no tenga candado moviendo el MÍNIMO de casos: cada receptor
 *                 conserva los suyos hasta su cuota y solo se reparte el excedente + los huérfanos.
 * En ambos modos los casos con candado se respetan, y cada pendiente va al receptor con menos carga
 * (desempate: menos casos de ese mismo tipo; luego el orden de la lista de receptores).
 */

import { ORDEN_DE_TIPO, tipoDeCaso, type TipoDeCaso } from './caseType';

// El tipo de caso vive en caseType.ts; se reexporta para quien ya lo importaba desde aquí.
export { ORDEN_DE_TIPO, tipoDeCaso, type TipoDeCaso };

export interface CasoParaRepartir {
  id: string;
  codigo: string;
  /** Receptor actual (null o uno que ya no participa = huérfano). */
  receptorId: string | null;
  bloqueado: boolean;
}

export type ModoDeReparto = 'huerfanos' | 'todos';

export interface ResultadoDelReparto {
  /** Solo los casos a los que se les eligió receptor: id del caso → id del receptor. */
  asignaciones: Map<string, string>;
  /** Cuántos cambiaron de receptor. */
  movidos: number;
  /** Cuántos pasaron por el reparto. */
  repartidos: number;
}

export function repartirCasos(casos: CasoParaRepartir[], receptores: string[], modo: ModoDeReparto = 'todos'): ResultadoDelReparto {
  const asignaciones = new Map<string, string>();
  if (receptores.length === 0) return { asignaciones, movidos: 0, repartidos: 0 };

  const activos = new Set(receptores);
  const carga = new Map(receptores.map((r) => [r, 0]));
  const cargaPorTipo = new Map(receptores.map((r) => [r, new Map<TipoDeCaso, number>()]));
  const conservados = new Map(receptores.map((r) => [r, [] as CasoParaRepartir[]]));
  const posicion = new Map(casos.map((c, i) => [c.id, i]));
  const esHuerfano = (c: CasoParaRepartir) => !c.receptorId || !activos.has(c.receptorId);

  const sumar = (receptor: string, caso: CasoParaRepartir) => {
    carga.set(receptor, carga.get(receptor)! + 1);
    const porTipo = cargaPorTipo.get(receptor)!;
    const tipo = tipoDeCaso(caso.codigo);
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + 1);
  };

  let pendientes: CasoParaRepartir[] = [];
  for (const caso of casos) {
    const huerfano = esHuerfano(caso);
    if (caso.bloqueado) {
      if (!huerfano) sumar(caso.receptorId!, caso); // candado: no se toca, pero cuenta
      continue;
    }
    if (huerfano) pendientes.push(caso);
    else if (modo === 'huerfanos') sumar(caso.receptorId!, caso); // ya asignado: no se toca
    else conservados.get(caso.receptorId!)!.push(caso);
  }

  if (modo === 'todos') {
    // Cuota pareja; los que ya tienen más conservan el "+1" del residuo.
    const total = casos.filter((c) => !c.bloqueado || !esHuerfano(c)).length;
    const base = Math.floor(total / receptores.length);
    const residuo = total % receptores.length;
    const tamanoActual = (r: string) => carga.get(r)! + conservados.get(r)!.length;
    const porCargaActual = [...receptores].sort((a, b) => tamanoActual(b) - tamanoActual(a));
    const cuota = new Map(porCargaActual.map((r, i) => [r, Math.max(base + (i < residuo ? 1 : 0), carga.get(r)!)]));

    for (const receptor of receptores) {
      const espacio = Math.max(0, cuota.get(receptor)! - carga.get(receptor)!);
      conservados.get(receptor)!.forEach((caso, i) => {
        if (i < espacio) sumar(receptor, caso);
        else pendientes.push(caso); // excedente → se reparte
      });
    }
  }

  pendientes = pendientes.sort(
    (a, b) => ORDEN_DE_TIPO[tipoDeCaso(a.codigo)] - ORDEN_DE_TIPO[tipoDeCaso(b.codigo)] || posicion.get(a.id)! - posicion.get(b.id)!
  );

  let movidos = 0;
  for (const caso of pendientes) {
    const tipo = tipoDeCaso(caso.codigo);
    const delTipo = (r: string) => cargaPorTipo.get(r)!.get(tipo) ?? 0;
    let mejor = receptores[0]!;
    for (const r of receptores) {
      if (carga.get(r)! < carga.get(mejor)! || (carga.get(r) === carga.get(mejor) && delTipo(r) < delTipo(mejor))) mejor = r;
    }
    sumar(mejor, caso);
    asignaciones.set(caso.id, mejor);
    if (caso.receptorId !== mejor) movidos++;
  }

  return { asignaciones, movidos, repartidos: pendientes.length };
}
