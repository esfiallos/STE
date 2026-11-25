import { describe, expect, it } from 'vitest';
import {
  avisosSinVer,
  avisoVigente,
  describirAviso,
  describirCambio,
  diaEditable,
  novedadesDeAvisos,
  pideMotivo,
  problemaDeAviso
} from '../../src/domain/planningNotices';
import type { AvisoPlanificacion } from '../../src/types/noc';

const HOY = '2026-11-09';
const AHORA = new Date('2026-11-09T16:00:00Z'); // 10:00 en Honduras

const aviso = (parcial: Partial<AvisoPlanificacion>): AvisoPlanificacion => ({
  id: 'a1',
  fecha: '2026-11-10',
  motivo: 'Falta Luis',
  autorNombre: 'Dispatch Uno',
  creadoEn: '2026-11-09T15:00:00Z',
  venceEn: '2026-11-10T12:00:00Z',
  cambios: [],
  visto: false,
  ...parcial
});

describe('planificación con aviso (D38)', () => {
  it('dispatch y coordinación planifican de hoy en adelante; el técnico no', () => {
    expect(diaEditable('2026-11-09', { rol: 'dispatch', hoy: HOY })).toBe(true);
    expect(diaEditable('2026-11-15', { rol: 'coordinador', hoy: HOY })).toBe(true);
    expect(diaEditable('2026-11-08', { rol: 'coordinador', hoy: HOY })).toBe(false);
    expect(diaEditable('2026-11-10', { rol: 'tecnico', hoy: HOY })).toBe(false);
  });

  it('el dispatch da el motivo una vez por día, mientras el aviso esté vigente; coordinación nunca', () => {
    const ctx = { rol: 'dispatch' as const, hoy: HOY, ahora: AHORA, avisos: [aviso({})] };
    expect(pideMotivo('2026-11-10', ctx)).toBe(false);
    expect(pideMotivo('2026-11-11', ctx)).toBe(true);
    expect(pideMotivo('2026-11-08', ctx)).toBe(false); // día pasado: ni se edita
    expect(pideMotivo('2026-11-11', { ...ctx, rol: 'coordinador' })).toBe(false);
    const vencido = [aviso({ venceEn: '2026-11-09T11:59:00Z' })];
    expect(avisoVigente('2026-11-10', vencido, AHORA)).toBeUndefined();
    expect(pideMotivo('2026-11-10', { ...ctx, avisos: vencido })).toBe(true);
  });

  it('valida el motivo igual que la base', () => {
    expect(problemaDeAviso('2026-11-08', 'x', HOY)).toBe('El 08/11 ya pasó: los días pasados no se planifican.');
    expect(problemaDeAviso('2026-11-10', '   ', HOY)).toBe('Indica el motivo del cambio.');
    expect(problemaDeAviso('2026-11-10', 'x'.repeat(501), HOY)).toBe('El motivo no puede pasar de 500 caracteres.');
    expect(problemaDeAviso('2026-11-10', 'Falta Luis', HOY)).toBeNull();
  });

  it('describe el aviso y cada cambio', () => {
    const cambio = { en: '', por: 'Dispatch Dos', tecnico: 'Beto', antes: 'Turno B', despues: 'Libre' };
    expect(describirAviso(aviso({ cambios: [cambio, cambio] }))).toBe('Dispatch Uno cambió la planificación del 10/11 (2 cambios): Falta Luis');
    expect(describirAviso(aviso({ autorNombre: null }))).toBe('Dispatch cambió la planificación del 10/11: Falta Luis');
    expect(describirCambio(cambio, 'Dispatch Uno')).toBe('Beto: Turno B → Libre · Dispatch Dos');
    expect(describirCambio(cambio, 'Dispatch Dos')).toBe('Beto: Turno B → Libre');
  });

  it('coordinación recibe los avisos nuevos o con cambios nuevos sin ver; el dispatch nada', () => {
    const a1 = aviso({});
    const a2 = aviso({ id: 'a2', creadoEn: '2026-11-09T15:30:00Z' });
    const a1Mas = { ...a1, cambios: [{ en: '', por: null, tecnico: 'Ana', antes: 'Libre', despues: 'Turno A' }] };
    expect(novedadesDeAvisos([a1], [a1Mas, a2], 'coordinador').map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(novedadesDeAvisos([a1], [a1, { ...a2, visto: true }], 'coordinador')).toEqual([]);
    expect(novedadesDeAvisos([], [a1], 'dispatch')).toEqual([]);
    expect(avisosSinVer([a1, a2, aviso({ id: 'a3', visto: true })]).map((a) => a.id)).toEqual(['a2', 'a1']);
  });
});
