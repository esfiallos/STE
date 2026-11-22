import { crearBorrador, enviarTraspaso, guardarItems } from '../../services/traspasosRepo';
import { cargarDatos } from '../../state/sync';
import type { ItemTraspaso, Traspaso } from '../../types/noc';
import { exito, type Resultado } from '../../types/result';
import { copiarAlPortapapeles, copiarHtmlAlPortapapeles } from '../ui/clipboard';
import { reproducirSonido } from '../ui/sound';
import { mostrarAviso } from '../ui/toast';

/** Guarda el borrador; si aún no existe, lo crea primero. Devuelve el traspaso con el que se guardó. */
export async function guardarBorrador(
  traspaso: Traspaso | null,
  tecnicoId: string,
  fecha: string,
  items: ItemTraspaso[],
  sobrantes: string[]
): Promise<Resultado<Traspaso>> {
  let actual = traspaso;
  if (!actual) {
    const creado = await crearBorrador(tecnicoId, fecha);
    if (!creado.ok) return creado;
    actual = creado.data;
  }
  const guardado = await guardarItems(actual.id, items, sobrantes);
  if (!guardado.ok) return guardado;
  return exito({ ...actual, items });
}

/** Cierra turno: guarda lo último, la base valida y entrega todo; después se recarga el tablero. */
export async function cerrarTurno(
  traspaso: Traspaso | null,
  tecnicoId: string,
  fecha: string,
  items: ItemTraspaso[],
  sobrantes: string[]
): Promise<Resultado<number>> {
  const guardado = await guardarBorrador(traspaso, tecnicoId, fecha, items, sobrantes);
  if (!guardado.ok) return guardado;
  const enviado = await enviarTraspaso(guardado.data.id);
  if (!enviado.ok) return enviado;

  reproducirSonido('asignar');
  mostrarAviso(`Turno cerrado: ${enviado.data} caso(s) entregado(s).`, 'exito');
  await cargarDatos();
  return enviado;
}

export type FormatoDeCopia = 'outlook' | 'texto' | 'tsv';

const NOMBRE_DEL_FORMATO: Record<FormatoDeCopia, string> = {
  outlook: 'Reporte para Outlook',
  texto: 'Reporte en texto',
  tsv: 'Reporte para Excel'
};

export async function copiarReporte(formato: FormatoDeCopia, salidas: { html: string; texto: string; tsv: string }): Promise<void> {
  if (!salidas.texto.trim()) {
    mostrarAviso('Todavía no hay casos con receptor para el reporte.');
    return;
  }
  const copiado =
    formato === 'outlook'
      ? await copiarHtmlAlPortapapeles(salidas.html, salidas.texto)
      : await copiarAlPortapapeles(formato === 'tsv' ? salidas.tsv : salidas.texto);
  if (copiado) {
    reproducirSonido('copiar');
    mostrarAviso(`${NOMBRE_DEL_FORMATO[formato]} copiado al portapapeles.`, 'exito');
  } else {
    mostrarAviso('No se pudo copiar. Inténtalo de nuevo.', 'error');
  }
}
