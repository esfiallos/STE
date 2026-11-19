export type TurnoId = 'turnoA' | 'turnoB' | 'turnoC';

/** Turno de un técnico en un día: A, B, C o "comodín" (horario propio que abarca varios turnos). */
export type TurnoTecnico = TurnoId | 'comodin';

/** Estado de un caso. Solo "cerrado" lo saca del flujo: todo lo demás se traspasa al cerrar turno. */
export type EstadoCaso = 'en_curso' | 'pausado' | 'resuelto' | 'cerrado';

/** Hora en formato 24 h "HH:MM". */
export type Hora = string;

export type EstadoConexion = 'conectando' | 'conectado' | 'desconectado';

export type Vista = 'tablero' | 'seguimiento' | 'planificacion' | 'historial' | 'bitacora';

/** Rol del usuario (tabla perfiles). El dispatch edita; el técnico solo consulta el tablero. */
export type Rol = 'dispatch' | 'tecnico';

export interface Perfil {
  nombre: string;
  rol: Rol;
  tecnicoId: string | null;
}

/** Técnico del catálogo (sin turno: el turno es de cada día, en su jornada). */
export interface TecnicoCatalogo {
  id: string;
  nombre: string;
  activo: boolean;
}

/** Turno, horario de comodín y almuerzo de un técnico en un día operativo. */
export interface Jornada {
  id: string;
  fecha: string;
  tecnicoId: string;
  turno: TurnoTecnico;
  horarioInicio: Hora | null;
  horarioFin: Hora | null;
  almuerzoInicio: Hora | null;
  almuerzoFin: Hora | null;
}

/** "vivo": tablero actual y editable. "historico": foto de un día pasado, solo lectura. */
export type ModoTablero = 'vivo' | 'historico';

/** Técnico tal como trabaja un día: catálogo + su jornada de ese día. */
export interface Tecnico {
  id: string;
  nombre: string;
  /** Jornada de la que salen turno, horario y almuerzo (null en fotos históricas). */
  jornadaId?: string | null;
  turno: TurnoTecnico;
  /** Solo para comodín: su horario laboral propio. */
  horarioInicio: Hora | null;
  horarioFin: Hora | null;
  almuerzoInicio: Hora | null;
  almuerzoFin: Hora | null;
}

/** Un caso tal como se ve en el tablero. */
export interface Incidente {
  id: string;
  codigo: string;
  nota: string | null;
  /** Responsable actual; null si quedó sin asignar. */
  tecnicoId: string | null;
  creadoEn: string;
  estado?: EstadoCaso;
  /** Día operativo en que el responsable actual tiene el caso (ver casos_abiertos). */
  fechaResponsable?: string | null;
  /** Cómo llegó el caso a su responsable actual (casos_abiertos.origen_responsable). */
  origenResponsable?: OrigenResponsable | null;
  cliente?: string | null;
  area?: string | null;
  descripcion?: string | null;
  etiqueta?: string | null;
  /** Texto corto que escribe el técnico; la base guarda quién y cuándo. */
  ultimaActualizacion?: string | null;
  ultimaActualizacionEn?: string | null;
  ultimaActualizacionPor?: string | null;
}

export type OrigenResponsable = 'dispatch' | 'reasignacion' | 'traspaso' | 'reapertura' | 'migracion';

/** Un tramo del historial de un caso: quién lo tuvo, en qué día operativo y cómo le llegó. */
export interface ResponsableCaso {
  tecnicoNombre: string;
  fechaOperativa: string;
  origen: OrigenResponsable;
  desde: string;
  hasta: string | null;
  asignadoPor: string;
}

export type TipoNotificacion = 'asignado' | 'reasignado' | 'traspaso';

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  casoId: string;
  /** Código del caso. */
  detalle: string | null;
  leida: boolean;
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
