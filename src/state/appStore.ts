import type {
  BorradorAsignacion,
  EstadoConexion,
  Incidente,
  Notificacion,
  AlertaCoordinacion,
  AvisoPlanificacion,
  Perfil,
  Tecnico,
  TecnicoCatalogo,
  TurnoId,
  Vista
} from '../types/noc';
import { createStore } from './createStore';
import { FILTROS_VACIOS, type FiltrosDeCasos } from '../domain/caseFilters';

export type EstadoCarga = 'cargando' | 'listo' | 'error';

export interface AppState {
  // Sesión
  perfil: Perfil | null;
  /** Sin rol dispatch no se edita nada (la base de datos también lo impide). */
  soloLectura: boolean;
  // Datos (vienen de Supabase)
  /** Fecha operativa (YYYY-MM-DD) que muestra el tablero: el día de 06:00 a 06:00 en curso. */
  fechaOperativa: string;
  catalogo: TecnicoCatalogo[];
  /** Técnicos con jornada en la fecha operativa (turno y almuerzo de ese día). */
  tecnicos: Tecnico[];
  /** Tablero del día (D16): lo que el dispatch asignó en la fecha operativa, incluidos los cerrados. */
  incidentes: Incidente[];
  /** Todos los casos abiertos (incluye los traspasados para el próximo turno): base del Seguimiento. */
  casosAbiertos: Incidente[];
  /** Notificaciones del técnico con sesión (vacío para el dispatch). */
  notificaciones: Notificacion[];
  /** Alertas de coordinación (vacío si no es coordinador). */
  alertas: AlertaCoordinacion[];
  /** Avisos de cambios del dispatch en la planificación (dispatch y coordinación, D38). */
  avisos: AvisoPlanificacion[];
  carga: EstadoCarga;
  errorCarga: string | null;
  conexion: EstadoConexion;
  // Interfaz
  vista: Vista;
  busqueda: string;
  /** Id del técnico al que se filtra el tablero ('' = todos). */
  filtroTecnico: string;
  /** Filtros de tipo, área y estado del tablero (§11.11; el de técnico es filtroTecnico). */
  filtrosTablero: FiltrosDeCasos;
  turnosColapsados: TurnoId[];
  /** Ids de los incidentes cuyo comentario está desplegado. */
  notasAbiertas: string[];
  /** "turno:tecnico" de la tarjeta que tiene abierto el formulario de asignación rápida. */
  claveFormulario: string | null;
  borrador: BorradorAsignacion | null;
}

export const appStore = createStore<AppState>({
  perfil: null,
  soloLectura: true,
  fechaOperativa: '',
  catalogo: [],
  tecnicos: [],
  incidentes: [],
  casosAbiertos: [],
  notificaciones: [],
  avisos: [],
  alertas: [],
  carga: 'cargando',
  errorCarga: null,
  conexion: 'conectando',
  vista: 'tablero',
  busqueda: '',
  filtroTecnico: '',
  filtrosTablero: { ...FILTROS_VACIOS },
  turnosColapsados: [],
  notasAbiertas: [],
  claveFormulario: null,
  borrador: null
});
