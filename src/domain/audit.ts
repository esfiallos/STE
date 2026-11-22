export const ETIQUETA_ACCION: Record<string, string> = {
  incidente_asignado: 'Incidente asignado',
  incidente_reasignado: 'Incidente reasignado',
  incidente_eliminado: 'Incidente eliminado',
  tecnico_agregado: 'Técnico agregado',
  tecnico_eliminado: 'Técnico eliminado',
  almuerzo_actualizado: 'Almuerzo actualizado',
  jornada_planificada: 'Jornada planificada',
  jornada_modificada: 'Jornada modificada',
  jornada_eliminada: 'Jornada eliminada',
  caso_creado: 'Caso creado',
  caso_reasignado: 'Caso reasignado',
  caso_traspasado: 'Caso traspasado',
  caso_sin_asignar: 'Caso sin asignar',
  estado_cambiado: 'Estado cambiado',
  etiqueta_cambiada: 'Etiqueta cambiada',
  ultima_actualizacion: 'Última actualización',
  traspaso_enviado: 'Traspaso enviado',
  asignado_por_ronda: 'Asignado por ronda',
  solicitud_planificacion: 'Permiso de planificación pedido',
  solicitud_planificacion_aprobada: 'Permiso de planificación aprobado',
  solicitud_planificacion_rechazada: 'Permiso de planificación rechazado'
};

export function describirAccion(accion: string): string {
  return ETIQUETA_ACCION[accion] ?? accion;
}
