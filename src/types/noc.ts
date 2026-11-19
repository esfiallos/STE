export type TurnoId = 'turnoA' | 'turnoB' | 'turnoC';

/** Un técnico pertenece a un turno fijo o es "comodín": horario propio que abarca varios turnos. */
export type TurnoTecnico = TurnoId | 'comodin';

/** Estado de un caso. Solo "cerrado" lo saca del flujo: todo lo demás se traspasa al cerrar turno. */
export type EstadoCaso = 'en_curso' | 'pausado' | 'resuelto' | 'cerrado';

/** Hora en formato 24 h "HH:MM". */
export type Hora = string;

export type EstadoConexion = 'conectando' | 'conectado' | 'desconectado';

export type Vista = 'tablero' | 'historial' | 'bitacora';

/** "vivo": tablero actual y editable. "historico": foto de un día pasado, solo lectura. */
export type ModoTablero = 'vivo' | 'historico';

export interface Tecnico {
  id: string;
  nombre: string;
  turno: TurnoTecnico;
  /** Solo para comodín: su horario laboral propio. */
  horarioInicio: Hora | null;
  horarioFin: Hora | null;
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

/** Texto a medio escribir en el formulario de asignación rápida de una tarjeta. */
export interface BorradorAsignacion {
  clave: string;
  codigo: string;
  nota: string;
}

export interface EntradaBitacora {
  id: string;
  creadoEn: string;
  usuario: string;
  accion: string;
  codigo: string | null;
  tecnico: string | null;
  detalle: string | null;
}

/** Un incidente que estaba en el tablero al cierre de un día. */
export interface CoincidenciaHistorial {
  fecha: string;
  codigo: string;
  nota: string | null;
  tecnico: string;
  turno: TurnoTecnico;
}
