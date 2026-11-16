import type { EstadoConexion, Incidente, Tecnico, TurnoId } from '../types/noc';
import { createStore } from './createStore';

export type EstadoCarga = 'cargando' | 'listo' | 'error';

export interface AppState {
  // Datos (vienen de Supabase)
  tecnicos: Tecnico[];
  incidentes: Incidente[];
  carga: EstadoCarga;
  errorCarga: string | null;
  conexion: EstadoConexion;
  // Interfaz
  busqueda: string;
  turnosColapsados: TurnoId[];
  modoConsulta: boolean;
}

export const appStore = createStore<AppState>({
  tecnicos: [],
  incidentes: [],
  carga: 'cargando',
  errorCarga: null,
  conexion: 'conectando',
  busqueda: '',
  turnosColapsados: [],
  modoConsulta: false
});
