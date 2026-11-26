/**
 * Usuarios de la app (pestaña Usuarios de coordinación, D39). Todo pasa por funciones de `sql/20_v2_usuarios.sql`,
 * que comprueban que quien llama es de coordinación y dejan cada cambio en la bitácora.
 */
import type { Rol, UsuarioApp } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaUsuario {
  id: string;
  correo: string;
  nombre: string;
  rol: Rol | null;
  activo: boolean;
  tecnico_id: string | null;
  ultimo_ingreso: string | null;
  creado_en: string | null;
  inhabilitado_en: string | null;
  inhabilitado_por: string | null;
}

const aUsuario = (f: FilaUsuario): UsuarioApp => ({
  id: f.id,
  correo: f.correo,
  nombre: f.nombre,
  rol: f.rol,
  activo: f.activo,
  tecnicoId: f.tecnico_id,
  ultimoIngreso: f.ultimo_ingreso,
  creadoEn: f.creado_en,
  inhabilitadoEn: f.inhabilitado_en,
  inhabilitadoPor: f.inhabilitado_por
});

export async function listarUsuarios(): Promise<Resultado<UsuarioApp[]>> {
  const { data, error } = await supabase.rpc('usuarios_de_la_app');
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar la lista de usuarios');
  return exito(((data ?? []) as FilaUsuario[]).map(aUsuario));
}

/** Crea la cuenta (confirmada, con la contraseña temporal), su perfil y, si es técnico, su ficha. Devuelve el id. */
export async function crearUsuario(datos: { correo: string; nombre: string; rol: Rol; contrasena: string }): Promise<Resultado<string>> {
  const { data, error } = await supabase.rpc('crear_usuario', {
    p_correo: datos.correo,
    p_nombre: datos.nombre,
    p_rol: datos.rol,
    p_contrasena: datos.contrasena
  });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo crear el usuario');
  return exito(String(data));
}

export async function actualizarUsuario(id: string, nombre: string, rol: Rol): Promise<Resultado> {
  const { error } = await supabase.rpc('actualizar_usuario', { p_usuario: id, p_nombre: nombre, p_rol: rol });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo guardar el usuario');
  return exito();
}

/** Devuelve cuántos casos abiertos tenía (si era técnico), para avisar que hay que repartirlos. */
export async function inhabilitarUsuario(id: string, motivo: string): Promise<Resultado<number>> {
  const { data, error } = await supabase.rpc('inhabilitar_usuario', { p_usuario: id, p_motivo: motivo });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo inhabilitar el usuario');
  return exito(Number(data ?? 0));
}

export async function habilitarUsuario(id: string): Promise<Resultado> {
  const { error } = await supabase.rpc('habilitar_usuario', { p_usuario: id });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo habilitar el usuario');
  return exito();
}

export async function cambiarContrasena(id: string, contrasena: string): Promise<Resultado> {
  const { error } = await supabase.rpc('cambiar_contrasena_de_usuario', { p_usuario: id, p_contrasena: contrasena });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cambiar la contraseña');
  return exito();
}
