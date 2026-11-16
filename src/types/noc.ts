export type TurnoId = 'turnoA' | 'turnoB' | 'turnoC';

/** Hora en formato 24 h "HH:MM". */
export type Hora = string;

export type EstadoConexion = 'conectando' | 'conectado' | 'desconectado';

export interface Tecnico {
  id: string;
  nombre: string;
  turno: TurnoId;
  almuerzoInicio: Hora | null;
  almuerzoFin: Hora | null;
}

export interface Incidente {
  id: string;
  codigo: string;
  nota: string | null;
  tecnicoId: string;
  creadoEn: string;
}

export interface TecnicoConIncidentes extends Tecnico {
  incidentes: Incidente[];
}
