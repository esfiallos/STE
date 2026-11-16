import { vi } from 'vitest';

/** Filas tal como las devuelve Postgres (snake_case, horas con segundos). */
export interface Datos {
  tecnicos: Record<string, unknown>[];
  incidentes: Record<string, unknown>[];
}

export function datosBase(): Datos {
  return {
    tecnicos: [
      { id: 'ana', nombre: 'Ana Pérez', turno: 'turnoA', horario_inicio: null, horario_fin: null, almuerzo_inicio: '12:00:00', almuerzo_fin: '12:30:00' },
      { id: 'luis', nombre: 'Luis Mora', turno: 'turnoB', horario_inicio: null, horario_fin: null, almuerzo_inicio: null, almuerzo_fin: null },
      { id: 'marta', nombre: 'Marta Soto', turno: 'comodin', horario_inicio: '07:00:00', horario_fin: '17:00:00', almuerzo_inicio: null, almuerzo_fin: null }
    ],
    incidentes: [
      { id: 'i1', codigo: 'INC1', nota: '<img src=x onerror=alert(1)>', tecnico_id: 'ana', created_at: '2026-11-09T10:00:00Z' }
    ]
  };
}

const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });

/**
 * Sustituye `fetch` por un mini Supabase en memoria (API REST de PostgREST).
 * Respeta la regla de la base de datos: el código del INC se guarda normalizado y no puede repetirse.
 */
export function crearBackendSimulado(datos: Datos = datosBase()) {
  const db: Record<string, Record<string, unknown>[]> = { tecnicos: datos.tecnicos, incidentes: datos.incidentes };
  const escrituras: string[] = [];
  let secuencia = 100;

  vi.stubGlobal('fetch', async (entrada: unknown, init?: RequestInit) => {
    const url = new URL(typeof entrada === 'string' ? entrada : ((entrada as Request).url ?? String(entrada)));
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const tabla = url.pathname.split('/').pop() as string;
    const filtros = [...url.searchParams].filter(([, valor]) => valor.startsWith('eq.'));
    const filas = (db[tabla] ?? []).filter((fila) => filtros.every(([campo, valor]) => String(fila[campo]) === valor.slice(3)));

    if (metodo !== 'GET') escrituras.push(`${metodo} ${tabla} ${init?.body ?? ''}`);
    if (metodo === 'GET') return json(filas);

    if (metodo === 'POST') {
      const cuerpo = JSON.parse(String(init?.body));
      const nuevo = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
      if (tabla === 'incidentes') {
        nuevo.codigo = String(nuevo.codigo).trim().toUpperCase();
        if (db.incidentes!.some((i) => i.codigo === nuevo.codigo)) {
          return json({ code: '23505', message: 'duplicate key value', details: '', hint: '' }, 409);
        }
      }
      db[tabla]!.push({ id: `n${secuencia++}`, created_at: new Date().toISOString(), ...nuevo });
      return new Response(null, { status: 201 });
    }

    if (metodo === 'PATCH') {
      const cambios = JSON.parse(String(init?.body));
      filas.forEach((fila) => Object.assign(fila, cambios));
      return new Response(null, { status: 204 });
    }

    if (metodo === 'DELETE') {
      db[tabla] = db[tabla]!.filter((fila) => !filas.includes(fila));
      return new Response(null, { status: 204 });
    }

    return json([]);
  });

  return { db, escrituras };
}
