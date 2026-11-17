import type {
  BorradorAsignacion,
  EstadoConexion,
  Incidente,
  Tecnico,
  TurnoId,
  Vista
} from '../types/noc';
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
  vista: Vista;
  busqueda: string;
  turnosColapsados: TurnoId[];
  modoConsulta: boolean;
  /** Ids de los incidentes cuyo comentario está desplegado. */
  notasAbiertas: string[];
  /** "turno:tecnico" de la tarjeta que tiene abierto el formulario de asignación rápida. */
  claveFormulario: string | null;
  borrador: BorradorAsignacion | null;
}

export const appStore = createStore<AppState>({
  tecnicos: [],
  incidentes: [],
  carga: 'cargando',
  errorCarga: null,
  conexion: 'conectando',
  vista: 'tablero',
  busqueda: '',
  turnosColapsados: [],
  modoConsulta: false,
  notasAbiertas: [],
  claveFormulario: null,
  borrador: null
});
