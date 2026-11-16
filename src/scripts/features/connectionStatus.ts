import { appStore } from '../../state/appStore';
import type { EstadoConexion } from '../../types/noc';
import { byId } from '../dom';

const ETIQUETAS: Record<EstadoConexion, string> = {
  conectando: 'Conectando…',
  conectado: 'En vivo',
  desconectado: 'Sin conexión en vivo'
};

/** Indicador de la cabecera: muestra si la sincronización en tiempo real está activa. */
export function iniciarEstadoDeConexion(): void {
  const indicador = byId('liveStatus');
  const texto = byId('liveStatusText');

  const pintar = () => {
    const { conexion } = appStore.get();
    indicador.dataset.estado = conexion;
    texto.textContent = ETIQUETAS[conexion];
  };

  appStore.subscribe(pintar);
  pintar();
}
