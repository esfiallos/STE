export const ETIQUETA_ACCION: Record<string, string> = {
  incidente_asignado: 'Incidente asignado',
  incidente_reasignado: 'Incidente reasignado',
  incidente_eliminado: 'Incidente eliminado',
  tecnico_agregado: 'Técnico agregado',
  tecnico_eliminado: 'Técnico eliminado',
  almuerzo_actualizado: 'Almuerzo actualizado'
};

export function describirAccion(accion: string): string {
  return ETIQUETA_ACCION[accion] ?? accion;
}
