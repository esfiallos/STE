import { vi } from 'vitest';
import { siguienteEnRonda, turnoEnCurso } from '../../src/domain/round';
import { fechaOperativa } from '../../src/domain/time';

type Fila = Record<string, unknown>;

/** Filas tal como las devuelve Postgres (snake_case, horas con segundos). */
export interface Datos {
  tecnicos: Fila[];
  jornadas: Fila[];
  /** `_fecha`: día operativo del responsable vigente (casos_abiertos.fecha_responsable); `_origen`: cómo le llegó. */
  casos: Fila[];
  notificaciones?: Fila[];
  caso_responsables?: Fila[];
  traspasos?: Fila[];
  traspaso_items?: Fila[];
  alertas_coordinacion?: Fila[];
}

/** Día de las pruebas: lunes 9 de noviembre de 2026 (ver fijarHora). */
export const HOY = '2026-11-09';

export function datosBase(): Datos {
  return {
    tecnicos: [
      { id: 'ana', nombre: 'Ana Pérez', activo: true },
      { id: 'luis', nombre: 'Luis Mora', activo: true },
      { id: 'marta', nombre: 'Marta Soto', activo: true }
    ],
    jornadas: [
      { id: 'j-ana', fecha_operativa: HOY, tecnico_id: 'ana', turno: 'turnoA', horario_inicio: null, horario_fin: null, almuerzo_inicio: '12:00:00', almuerzo_fin: '12:30:00' },
      { id: 'j-luis', fecha_operativa: HOY, tecnico_id: 'luis', turno: 'turnoB', horario_inicio: null, horario_fin: null, almuerzo_inicio: null, almuerzo_fin: null },
      { id: 'j-marta', fecha_operativa: HOY, tecnico_id: 'marta', turno: 'comodin', horario_inicio: '07:00:00', horario_fin: '17:00:00', almuerzo_inicio: null, almuerzo_fin: null }
    ],
    casos: [
      { id: 'i1', codigo: 'INC1', nota: '<img src=x onerror=alert(1)>', estado: 'en_curso', tecnico_actual_id: 'ana', creado_en: '2026-11-09T10:00:00Z', _fecha: HOY }
    ]
  };
}

const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
const duplicado = () => json({ code: '23505', message: 'duplicate key value', details: '', hint: '' }, 409);

function cumpleFiltros(fila: Fila, parametros: URLSearchParams): boolean {
  return [...parametros].every(([campo, valor]) => {
    const [op, ...resto] = valor.split('.');
    const esperado = resto.join('.');
    const actual = String(fila[campo]);
    if (op === 'eq') return actual === esperado;
    if (op === 'gte') return actual >= esperado;
    if (op === 'lte') return actual <= esperado;
    if (op === 'in') return esperado.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).includes(actual);
    return true; // select, order, limit, on_conflict, columns...
  });
}

/**
 * Sustituye `fetch` por un mini Supabase en memoria (API REST de PostgREST).
 * Imita las reglas de la base: código de caso normalizado y único, nombre de técnico único,
 * una jornada por técnico y día (upsert), y la vista casos_abiertos.
 */
export function crearBackendSimulado(datos: Datos = datosBase()) {
  const db: Record<string, Fila[]> = {
    tecnicos: datos.tecnicos,
    jornadas: datos.jornadas,
    casos: datos.casos,
    perfiles: [],
    notificaciones: datos.notificaciones ?? [],
    caso_responsables: datos.caso_responsables ?? [],
    traspasos: datos.traspasos ?? [],
    traspaso_items: datos.traspaso_items ?? [],
    alertas_coordinacion: datos.alertas_coordinacion ?? [],
    ronda_estado: []
  };
  const escrituras: string[] = [];
  let secuencia = 100;
  const nuevoId = () => `n${secuencia++}`;

  const casosAbiertos = () =>
    db.casos!
      .filter((c) => c.estado !== 'cerrado')
      .map((c) => ({
        ...c,
        fecha_responsable: c.tecnico_actual_id ? c._fecha : null,
        asignado_en: c.creado_en,
        origen_responsable: c.tecnico_actual_id ? (c._origen ?? 'dispatch') : null
      }));

  /** Imita enviar_traspaso(): valida lo básico, entrega cada caso y marca el traspaso como enviado. */
  function enviarTraspaso(id: string): Response {
    const traspaso = db.traspasos!.find((t) => t.id === id);
    if (!traspaso || traspaso.estado !== 'borrador') return json({ code: 'P0001', message: 'Este traspaso ya fue enviado.' }, 400);
    const items = db.traspaso_items!.filter((i) => i.traspaso_id === id);
    const pendiente = items.find((i) => i.estado !== 'cerrado' && (!i.para_tecnico_id || !String(i.ultima_actualizacion ?? '').trim()));
    if (pendiente) return json({ code: 'P0001', message: 'Falta receptor o última actualización.' }, 400);
    let movidos = 0;
    for (const item of items) {
      const caso = db.casos!.find((c) => c.id === item.caso_id)!;
      if (item.estado === 'cerrado') {
        Object.assign(caso, { estado: 'cerrado' });
        continue;
      }
      const destino = db.jornadas!.find((j) => j.tecnico_id === item.para_tecnico_id)?.fecha_operativa ?? traspaso.fecha_operativa;
      Object.assign(caso, {
        tecnico_actual_id: item.para_tecnico_id, estado: item.estado, etiqueta: item.etiqueta, ultima_actualizacion: item.ultima_actualizacion,
        recordatorio_fecha: item.recordatorio_fecha, recordatorio_texto: item.recordatorio_texto, _origen: 'traspaso', _fecha: destino
      });
      item.fecha_destino = destino;
      movidos++;
    }
    Object.assign(traspaso, { estado: 'enviado', turno_origen: 'turnoA', enviado_en: new Date().toISOString() });
    return json(movidos);
  }

  vi.stubGlobal('fetch', async (entrada: unknown, init?: RequestInit) => {
    const url = new URL(typeof entrada === 'string' ? entrada : ((entrada as Request).url ?? String(entrada)));
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const tabla = url.pathname.split('/').pop() as string;
    const cabeceras = new Headers(init?.headers);
    if (url.pathname.includes('/rpc/')) {
      escrituras.push(`RPC ${tabla} ${init?.body ?? ''}`);
      const parametros = JSON.parse(String(init?.body ?? '{}'));
      if (tabla === 'enviar_traspaso') return enviarTraspaso(parametros.p_traspaso);
      if (tabla === 'buscar_casos') {
        const termino = String(parametros.p_termino).trim().toLowerCase();
        const nombre = (id: unknown) => db.tecnicos!.find((t) => t.id === id)?.nombre ?? null;
        return json(
          db.casos!
            .filter((c) => termino && [c.codigo, c.cliente, c.nota, c.area, nombre(c.tecnico_actual_id)].some((v) => String(v ?? '').toLowerCase().includes(termino)))
            .map((c) => ({ descripcion: null, etiqueta: null, cliente: null, area: null, ...c, tecnico_actual: nombre(c.tecnico_actual_id) }))
        );
      }
      if (tabla === 'asignar_a_ronda') {
        // Imita la ronda: candidatos = técnicos con jornada hoy (sin revisar horario), siguiente en orden alfabético.
        const codigo = String(parametros.p_codigo).trim().toUpperCase();
        if (db.casos!.some((c) => c.codigo === codigo)) return json({ code: '23505', message: `El caso ${codigo} ya existe: asígnalo a un técnico concreto.` }, 409);
        const hoy = fechaOperativa(new Date());
        const turno = turnoEnCurso(new Date());
        const candidatos = db.jornadas!
          .filter((j) => j.fecha_operativa === hoy)
          .map((j) => db.tecnicos!.find((t) => t.id === j.tecnico_id)!)
          .map((t) => ({ id: String(t.id), nombre: String(t.nombre) }));
        let puntero = db.ronda_estado!.find((r) => r.fecha_operativa === hoy && r.turno === turno);
        const elegido = siguienteEnRonda(candidatos, (puntero?.ultimo_nombre as string | undefined) ?? null);
        if (!elegido) return json({ code: 'P0001', message: 'No hay técnicos disponibles ahora para la ronda.' }, 400);
        if (!puntero) db.ronda_estado!.push((puntero = { fecha_operativa: hoy, turno }));
        Object.assign(puntero, { ultimo_tecnico_id: elegido.id, ultimo_nombre: elegido.nombre });
        const id = nuevoId();
        db.casos!.push({ id, codigo, nota: parametros.p_nota, estado: 'en_curso', tecnico_actual_id: elegido.id, creado_en: new Date().toISOString(), _fecha: hoy });
        return json([{ caso_id: id, tecnico_id: elegido.id, tecnico_nombre: elegido.nombre }]);
      }
      if (tabla === 'estadisticas_del_dia') {
        const totales = new Map<string, number>();
        for (const c of db.casos!) if (c._fecha === parametros.p_fecha) totales.set(String(c.estado), (totales.get(String(c.estado)) ?? 0) + 1);
        return json([...totales].map(([estado, total]) => ({ estado, total })));
      }
      return json(null);
    }
    const origen: Fila[] = tabla === 'casos_abiertos' ? casosAbiertos() : (db[tabla] ?? []);
    const filas = origen.filter((fila) => cumpleFiltros(fila, url.searchParams));

    if (metodo !== 'GET') escrituras.push(`${metodo} ${tabla} ${init?.body ?? ''}`);
    if (metodo === 'GET') return json(filas);

    if (metodo === 'POST') {
      const cuerpo = JSON.parse(String(init?.body));
      const creados: Fila[] = [];
      for (const nuevo of Array.isArray(cuerpo) ? cuerpo : [cuerpo]) {
        if (tabla === 'casos') {
          nuevo.codigo = String(nuevo.codigo).trim().toUpperCase();
          if (db.casos!.some((c) => c.codigo === nuevo.codigo)) return duplicado();
          db.casos!.push({ id: nuevoId(), estado: 'en_curso', creado_en: new Date().toISOString(), _fecha: fechaOperativa(new Date()), ...nuevo });
        } else if (tabla === 'tecnicos') {
          const nombre = String(nuevo.nombre).trim().toLowerCase();
          if (db.tecnicos!.some((t) => String(t.nombre).toLowerCase() === nombre)) return duplicado();
          db.tecnicos!.push({ id: nuevoId(), activo: true, ...nuevo });
        } else if (tabla === 'jornadas') {
          const existente = db.jornadas!.find((j) => j.fecha_operativa === nuevo.fecha_operativa && j.tecnico_id === nuevo.tecnico_id);
          if (existente) Object.assign(existente, nuevo);
          else db.jornadas!.push({ id: nuevoId(), ...nuevo });
        } else if (tabla === 'traspaso_items') {
          const existente = db.traspaso_items!.find((i) => i.traspaso_id === nuevo.traspaso_id && i.caso_id === nuevo.caso_id);
          if (existente) Object.assign(existente, nuevo);
          else db.traspaso_items!.push({ id: nuevoId(), fecha_destino: null, ...nuevo });
        } else if (tabla === 'traspasos') {
          if (db.traspasos!.some((t) => t.de_tecnico_id === nuevo.de_tecnico_id && t.fecha_operativa === nuevo.fecha_operativa)) return duplicado();
          const fila = { id: nuevoId(), estado: 'borrador', turno_origen: null, enviado_en: null, ...nuevo };
          db.traspasos!.push(fila);
          creados.push(fila);
        } else {
          (db[tabla] ??= []).push({ id: nuevoId(), ...nuevo });
        }
      }
      if (cabeceras.get('prefer')?.includes('return=representation')) {
        const unico = cabeceras.get('accept')?.includes('vnd.pgrst.object');
        return json(unico ? creados[0] : creados, 201);
      }
      return new Response(null, { status: 201 });
    }

    if (metodo === 'PATCH') {
      const cambios = JSON.parse(String(init?.body));
      filas.forEach((fila) => {
        const original = (db[tabla] ?? []).find((f) => f.id === fila.id) ?? fila;
        const cambiaResponsable =
          tabla === 'casos' && ('tecnico_actual_id' in cambios || (original.estado === 'cerrado' && cambios.estado !== 'cerrado'));
        Object.assign(original, cambios);
        if (cambiaResponsable) {
          original._fecha = fechaOperativa(new Date());
          original._origen = 'reasignacion';
        }
      });
      return new Response(null, { status: 204 });
    }

    if (metodo === 'DELETE') {
      const ids = new Set(filas.map((f) => f.id));
      db[tabla] = (db[tabla] ?? []).filter((fila) => !ids.has(fila.id));
      return new Response(null, { status: 204 });
    }

    return json([]);
  });

  return { db, escrituras };
}
