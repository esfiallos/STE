import { describe, expect, it } from 'vitest';
import {
  describirRespuesta,
  describirSolicitud,
  diaEditable,
  estadoDelDia,
  novedadesDeSolicitudes,
  problemaDeSolicitud,
  respuestasSinVer,
  solicitudesPorResponder
} from '../../src/domain/planningRequests';
import type { SolicitudPlanificacion } from '../../src/types/noc';

const HOY = '2026-11-09';
const AHORA = new Date('2026-11-09T16:00:00Z'); // 10:00 en Honduras

const solicitud = (parcial: Partial<SolicitudPlanificacion>): SolicitudPlanificacion => ({
  id: 's1',
  fecha: '2026-11-10',
  motivo: 'Falta Luis',
  solicitanteNombre: 'Dispatch Uno',
  estado: 'pendiente',
  respuesta: null,
  resueltaPorNombre: null,
  resueltaEn: null,
  venceEn: null,
  respuestaVista: false,
  creadaEn: '2026-11-09T15:00:00Z',
  ...parcial
});

const aprobada = solicitud({ id: 'a', fecha: '2026-11-11', estado: 'aprobada', resueltaPorNombre: 'Coord', resueltaEn: '2026-11-09T15:30:00Z', venceEn: '2026-11-10T12:00:00Z' });
const vencida = solicitud({ id: 'v', fecha: '2026-11-12', estado: 'aprobada', resueltaEn: '2026-11-08T15:30:00Z', venceEn: '2026-11-09T12:00:00Z' });
const pendiente = solicitud({ id: 'p', fecha: '2026-11-10' });

describe('quién puede editar un día de la planificación (D14, D15)', () => {
  const ctx = (rol: 'dispatch' | 'coordinador' | 'tecnico') => ({ rol, hoy: HOY, ahora: AHORA, solicitudes: [aprobada, vencida, pendiente] });

  it('nadie edita días pasados; coordinación edita de hoy en adelante', () => {
    expect(diaEditable('2026-11-08', ctx('coordinador'))).toBe(false);
    expect(diaEditable(HOY, ctx('coordinador'))).toBe(true);
    expect(diaEditable('2026-12-01', ctx('coordinador'))).toBe(true);
  });

  it('el dispatch solo edita días con una aprobación vigente; el técnico nunca', () => {
    expect(diaEditable('2026-11-11', ctx('dispatch'))).toBe(true);
    expect(diaEditable('2026-11-12', ctx('dispatch'))).toBe(false); // venció
    expect(diaEditable('2026-11-10', ctx('dispatch'))).toBe(false); // pendiente
    expect(diaEditable(HOY, ctx('dispatch'))).toBe(false);
    expect(diaEditable('2026-11-11', ctx('tecnico'))).toBe(false);
  });

  it('estado del día para el encabezado', () => {
    const c = ctx('dispatch');
    expect(['2026-11-08', '2026-11-10', '2026-11-11', '2026-11-12'].map((f) => estadoDelDia(f, c))).toEqual([
      'pasado',
      'pendiente',
      'habilitado',
      'bloqueado'
    ]);
  });
});

describe('solicitudes de edición', () => {
  const ctx = { hoy: HOY, ahora: AHORA, solicitudes: [aprobada, pendiente] };

  it('valida lo mismo que la base antes de enviar', () => {
    expect(problemaDeSolicitud('', 'x', ctx)).toMatch(/Indica el día/);
    expect(problemaDeSolicitud('2026-11-08', 'x', ctx)).toBe('El 08/11 ya pasó: los días pasados no se planifican.');
    expect(problemaDeSolicitud('2026-11-13', '   ', ctx)).toBe('Indica el motivo de la solicitud.');
    expect(problemaDeSolicitud('2026-11-13', 'x'.repeat(501), ctx)).toMatch(/500/);
    expect(problemaDeSolicitud('2026-11-11', 'x', ctx)).toBe('El 11/11 ya está habilitado para editar.');
    expect(problemaDeSolicitud('2026-11-10', 'x', ctx)).toBe('Ya hay una solicitud pendiente para el 10/11.');
    expect(problemaDeSolicitud('2026-11-13', ' Falta Luis ', ctx)).toBeNull();
  });

  it('coordinación ve las pendientes de hoy en adelante; el dispatch, las respuestas sin ver', () => {
    const vieja = solicitud({ id: 'old', fecha: '2026-11-05' });
    const otra = solicitud({ id: 'p2', fecha: '2026-11-14', creadaEn: '2026-11-09T14:00:00Z' });
    expect(solicitudesPorResponder([pendiente, vieja, otra, aprobada], HOY).map((s) => s.id)).toEqual(['p2', 'p']);
    const vista = { ...aprobada, id: 'vista', respuestaVista: true };
    expect(respuestasSinVer([pendiente, aprobada, vista]).map((s) => s.id)).toEqual(['a']);
  });

  it('textos para la campana', () => {
    expect(describirSolicitud(pendiente)).toBe('Dispatch Uno pide editar la planificación del 10/11: Falta Luis');
    expect(describirRespuesta(aprobada)).toBe('Coord aprobó editar el 11/11 (hasta las 06:00).');
    expect(describirRespuesta({ ...pendiente, estado: 'rechazada', respuesta: 'Hoy no', resueltaEn: 'x' })).toBe('Coordinación rechazó editar el 10/11: Hoy no');
  });

  it('avisa a coordinación de las nuevas y al dispatch de las recién respondidas', () => {
    const respondida = { ...pendiente, estado: 'aprobada' as const, venceEn: 'x', resueltaEn: 'x' };
    const nueva = solicitud({ id: 'n' });
    expect(novedadesDeSolicitudes([pendiente], [pendiente, nueva], 'coordinador').map((s) => s.id)).toEqual(['n']);
    expect(novedadesDeSolicitudes([pendiente], [respondida], 'dispatch').map((s) => s.id)).toEqual(['p']);
    expect(novedadesDeSolicitudes([], [respondida], 'dispatch')).toEqual([]); // primera carga: sin avisos
    expect(novedadesDeSolicitudes([pendiente], [respondida], 'tecnico')).toEqual([]);
  });
});
