/**
 * Reglas de la pestaña Usuarios (coordinación, D39). Las mismas que impone `sql/20_v2_usuarios.sql`; aquí solo
 * sirven para avisar antes de llamar a la base y para filtrar la lista.
 */
import type { Rol, UsuarioApp } from '../types/noc';
import { sinAcentos } from './search';

export const ROLES: readonly Rol[] = ['tecnico', 'dispatch', 'coordinador'];

const NOMBRE_DE_ROL: Record<Rol, string> = { tecnico: 'Técnico', dispatch: 'Dispatch', coordinador: 'Coordinación' };

export function nombreDeRol(rol: Rol | null): string {
  return rol ? NOMBRE_DE_ROL[rol] : 'Sin rol';
}

export const esRol = (valor: unknown): valor is Rol => ROLES.includes(valor as Rol);

export const MIN_CONTRASENA = 8;
export const MAX_CONTRASENA = 72;
export const MAX_NOMBRE = 80;

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function problemaDeContrasena(contrasena: string): string | null {
  if (contrasena.length < MIN_CONTRASENA || new TextEncoder().encode(contrasena).length > MAX_CONTRASENA) {
    return `La contraseña temporal debe tener entre ${MIN_CONTRASENA} y ${MAX_CONTRASENA} caracteres.`;
  }
  return null;
}

export function problemaDeDatos(nombre: string, rol: unknown): string | null {
  const limpio = nombre.trim();
  if (!limpio || limpio.length > MAX_NOMBRE) return `El nombre es obligatorio (máximo ${MAX_NOMBRE} caracteres).`;
  if (!esRol(rol)) return 'Elige un rol: Técnico, Dispatch o Coordinación.';
  return null;
}

/** Primer problema de un usuario nuevo (null si se puede crear). `existentes`: correos que ya tienen cuenta. */
export function problemaDeUsuarioNuevo(
  datos: { correo: string; nombre: string; rol: unknown; contrasena: string },
  existentes: readonly string[] = []
): string | null {
  const correo = datos.correo.trim().toLowerCase();
  if (!CORREO.test(correo) || correo.length > 254) return 'Escribe un correo válido.';
  if (existentes.some((c) => c.toLowerCase() === correo)) {
    return `Ya existe una cuenta con el correo ${correo}: búscala en la lista y cámbiale el rol.`;
  }
  return problemaDeDatos(datos.nombre, datos.rol) ?? problemaDeContrasena(datos.contrasena);
}

/** Sin 0/O, 1/l/I: se dicta por teléfono o se copia a mano sin confusiones. */
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const SIMBOLOS = '-_.!?';

/**
 * Contraseña temporal aleatoria de `largo` caracteres con al menos una mayúscula, una minúscula, un dígito y un
 * símbolo. `aleatorio(n)` devuelve n enteros sin signo (por defecto `crypto.getRandomValues`, inyectable en pruebas).
 */
export function generarContrasenaTemporal(
  largo = 12,
  aleatorio: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))
): string {
  const grupos = [MAYUSCULAS, MINUSCULAS, DIGITOS, SIMBOLOS];
  const todos = grupos.join('');
  const azar = aleatorio(largo * 2);
  const letras = Array.from({ length: largo }, (_, i) => {
    const fuente = i < grupos.length ? grupos[i]! : todos;
    return fuente[azar[i]! % fuente.length]!;
  });
  // Mezcla (Fisher–Yates) para que los obligatorios no queden siempre al principio
  for (let i = letras.length - 1; i > 0; i--) {
    const j = azar[largo + i]! % (i + 1);
    [letras[i], letras[j]] = [letras[j]!, letras[i]!];
  }
  return letras.join('');
}

export type FiltroDeUsuarios = 'activos' | 'inhabilitados' | 'sin-rol' | 'todos';

export const estadoDeUsuario = (u: UsuarioApp): Exclude<FiltroDeUsuarios, 'todos'> =>
  u.rol === null ? 'sin-rol' : u.activo ? 'activos' : 'inhabilitados';

/** Filtra por estado y por texto (nombre, correo o rol, sin distinguir tildes ni mayúsculas). */
export function filtrarUsuarios(usuarios: readonly UsuarioApp[], texto: string, filtro: FiltroDeUsuarios): UsuarioApp[] {
  const buscado = sinAcentos(texto.trim());
  return usuarios.filter(
    (u) =>
      (filtro === 'todos' || estadoDeUsuario(u) === filtro) &&
      (!buscado || [u.nombre, u.correo, nombreDeRol(u.rol)].some((v) => sinAcentos(v).includes(buscado)))
  );
}

/** Cuántos usuarios hay en cada filtro (para los contadores de la lista). */
export function conteoDeUsuarios(usuarios: readonly UsuarioApp[]): Record<FiltroDeUsuarios, number> {
  const conteo: Record<FiltroDeUsuarios, number> = { activos: 0, inhabilitados: 0, 'sin-rol': 0, todos: usuarios.length };
  for (const u of usuarios) conteo[estadoDeUsuario(u)]++;
  return conteo;
}

const coordinadoresActivos = (usuarios: readonly UsuarioApp[], salvo: string) =>
  usuarios.filter((u) => u.rol === 'coordinador' && u.activo && u.id !== salvo).length;

/** Por qué no se puede cambiar el rol de alguien a `nuevoRol` (null si se puede). */
export function motivoParaNoCambiarRol(usuario: UsuarioApp, nuevoRol: Rol, miId: string, usuarios: readonly UsuarioApp[]): string | null {
  if (usuario.rol === nuevoRol) return null;
  if (usuario.id === miId) return 'No puedes cambiar tu propio rol: pídeselo a otra persona de coordinación.';
  if (usuario.rol === 'coordinador' && usuario.activo && coordinadoresActivos(usuarios, usuario.id) === 0) {
    return 'Debe quedar al menos una persona de coordinación activa.';
  }
  return null;
}

/** Por qué no se puede inhabilitar a alguien (null si se puede). */
export function motivoParaNoInhabilitar(usuario: UsuarioApp, miId: string, usuarios: readonly UsuarioApp[]): string | null {
  if (usuario.id === miId) return 'No puedes inhabilitar tu propio usuario.';
  if (usuario.rol === null) return 'Esta cuenta no tiene rol en la app: ya no puede entrar.';
  if (usuario.rol === 'coordinador' && coordinadoresActivos(usuarios, usuario.id) === 0) {
    return 'Debe quedar al menos una persona de coordinación activa.';
  }
  return null;
}

/** Qué pasa al cambiar de rol (texto para la confirmación), o null si no hay nada que avisar. */
export function avisoDeCambioDeRol(usuario: UsuarioApp, nuevoRol: Rol): string | null {
  if (usuario.rol === nuevoRol) return null;
  if (usuario.rol === 'tecnico') {
    return 'Deja de ser técnico: su ficha se desactiva (sale de la planificación y del tablero) y sus casos abiertos quedan en "Por reasignar".';
  }
  if (nuevoRol === 'tecnico') return 'Pasa a ser técnico: se le crea (o reactiva) su ficha y ya se puede planificar.';
  return null;
}

/** Aviso después de inhabilitar a alguien con casos abiertos. */
export function avisoDeCasosAbiertos(nombre: string, abiertos: number): string | null {
  if (abiertos <= 0) return null;
  const casos = abiertos === 1 ? '1 caso abierto' : `${abiertos} casos abiertos`;
  return `${nombre} tenía ${casos}: repártelos desde "Por reasignar" en el Tablero.`;
}

/** Texto para copiar y entregar a la persona (correo + contraseña temporal). */
export function textoDeAcceso(correo: string, contrasena: string, url: string): string {
  return [`Panel NOC: ${url}`, `Usuario: ${correo}`, `Contraseña temporal: ${contrasena}`].join('\n');
}
