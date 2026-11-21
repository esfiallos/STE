export type TurnoId = 'turnoA' | 'turnoB' | 'turnoC';

/** Turno de un técnico en un día: A, B, C o "comodín" (horario propio que abarca varios turnos). */
export type TurnoTecnico = TurnoId | 'comodin';

/** Estado de un caso. Solo "cerrado" lo saca del flujo: todo lo demás se traspasa al cerrar turno. */
export type EstadoCaso = 'en_curso' | 'pausado' | 'resuelto' | 'cerrado';

/** Hora en formato 24 h "HH:MM". */
export type Hora = string;

export type EstadoConexion = 'conectando' | 'conectado' | 'desconectado';

export type Vista =
  | 'panel'
  | 'tablero'
  | 'busqueda'
  | 'seguimiento'
  | 'traspaso'
  | 'misTraspasos'
  | 'planificacion'
  | 'historial'
  | 'bitacora';

/** Rol del usuario (tabla perfiles). El dispatch edita; el técnico gestiona sus casos; el coordinador supervisa (solo lee). */
export type Rol = 'dispatch' | 'tecnico' | 'coordinador';

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
  /** Última edición del técnico responsable (migración 07). */
  actividadTecnicoEn?: string | null;
  /** Recordatorio que dejó quien traspasó: avisa al inicio del turno de ese día operativo. */
  recordatorioFecha?: string | null;
  recordatorioTexto?: string | null;
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

export type TipoNotificacion = 'asignado' | 'reasignado' | 'traspaso' | 'recordatorio';

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

/** Un caso dentro del traspaso de fin de turno (tabla traspaso_items). */
export interface ItemTraspaso {
  casoId: string;
  /** A quién se entrega; null mientras no se elija (o si el caso se cierra). */
  paraTecnicoId: string | null;
  estado: EstadoCaso;
  etiqueta: string | null;
  /** Nota para quien recibe (se adjunta a la descripción del reporte). */
  notaPersonalizada: string | null;
  ultimaActualizacion: string | null;
  recordatorioFecha: string | null;
  recordatorioTexto: string | null;
}

export type EstadoTraspaso = 'borrador' | 'enviado';

/** Traspaso de un técnico en un día operativo (uno por técnico y día). */
export interface Traspaso {
  id: string;
  deTecnicoId: string;
  fecha: string;
  turnoOrigen: TurnoTecnico | null;
  estado: EstadoTraspaso;
  enviadoEn: string | null;
  items: ItemTraspaso[];
}

/** Técnico planificado que puede recibir el traspaso, con el día operativo en que lo recibe. */
export interface ReceptorTraspaso {
  tecnicoId: string;
  nombre: string;
  turno: TurnoTecnico;
  fecha: string;
  horarioInicio: Hora | null;
  horarioFin: Hora | null;
}

/** Un caso de un traspaso ya enviado, con los datos del caso (pantalla "Mis traspasos"). */
export interface ItemTraspasoEnviado extends ItemTraspaso {
  traspasoId: string;
  codigo: string;
  cliente: string | null;
  area: string | null;
  nota: string | null;
  /** Día operativo en que el receptor recibió el caso (null si se cerró). */
  fechaDestino: string | null;
}

/** Traspaso enviado (propio o recibido) para consultar un día concreto. */
export interface TraspasoEnviado {
  id: string;
  deTecnicoId: string;
  fecha: string;
  turnoOrigen: TurnoTecnico | null;
  enviadoEn: string | null;
  items: ItemTraspasoEnviado[];
}

export type TipoAlerta = 'sin_actualizacion' | 'recordatorio_sin_jornada';

/** Aviso para coordinación (tabla alertas_coordinacion). */
export interface AlertaCoordinacion {
  id: string;
  tipo: TipoAlerta;
  casoId: string;
  tecnicoId: string | null;
  tecnicoNombre: string | null;
  /** Horas sin actualización (2, 4 o 6); null en los recordatorios. */
  nivel: 2 | 4 | 6 | null;
  /** Desde cuándo se cuenta (última actividad, recepción del caso o inicio del turno). */
  referencia: string;
  /** Código del caso (y texto del recordatorio). */
  detalle: string | null;
  leida: boolean;
  creadoEn: string;
}

/** Un caso del buscador global (abierto o cerrado). */
export interface CasoEncontrado {
  id: string;
  codigo: string;
  cliente: string | null;
  area: string | null;
  nota: string | null;
  descripcion: string | null;
  estado: EstadoCaso;
  etiqueta: string | null;
  ultimaActualizacion: string | null;
  ultimaActualizacionEn: string | null;
  ultimaActualizacionPor: string | null;
  actividadTecnicoEn: string | null;
  tecnicoActualId: string | null;
  tecnicoActual: string | null;
  creadoEn: string;
  creadoPor: string | null;
  cerradoEn: string | null;
  recordatorioFecha: string | null;
  recordatorioTexto: string | null;
}

/** Un paso de un caso por un traspaso (ficha del buscador). */
export interface TraspasoDelCaso {
  fecha: string;
  deTecnicoId: string;
  paraTecnicoId: string | null;
  fechaDestino: string | null;
  estado: EstadoCaso;
  etiqueta: string | null;
  notaPersonalizada: string | null;
  ultimaActualizacion: string | null;
  enviadoEn: string | null;
}
