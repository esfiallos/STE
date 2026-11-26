/**
 * Pestaña "Usuarios" de coordinación (D39): lista, búsqueda y filtros, y el modal para crear, editar (nombre y rol)
 * o poner una contraseña temporal. Inhabilitar pide el motivo; habilitar se confirma junto al botón.
 * Las reglas las impone la base (sql/20); aquí se avisan antes con domain/usuarios.ts.
 */
import { haceCuanto } from '../../domain/followUp';
import {
  avisoDeCambioDeRol,
  avisoDeCasosAbiertos,
  conteoDeUsuarios,
  esRol,
  filtrarUsuarios,
  generarContrasenaTemporal,
  motivoParaNoCambiarRol,
  motivoParaNoInhabilitar,
  nombreDeRol,
  problemaDeContrasena,
  problemaDeDatos,
  problemaDeUsuarioNuevo,
  textoDeAcceso,
  type FiltroDeUsuarios
} from '../../domain/usuarios';
import {
  actualizarUsuario,
  cambiarContrasena,
  crearUsuario,
  habilitarUsuario,
  inhabilitarUsuario,
  listarUsuarios
} from '../../services/usuariosRepo';
import type { Rol, UsuarioApp } from '../../types/noc';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { abrirModal, cerrarModal, establecerError } from '../modals/modal';
import { RUTAS } from '../routes';
import { copiarAlPortapapeles } from '../ui/clipboard';
import { confirmar } from '../ui/confirmar';
import { formatearFechaHora } from '../ui/format';
import { pedirTexto } from '../ui/pedirTexto';
import { mostrarAviso } from '../ui/toast';

type Modo = 'crear' | 'editar' | 'contrasena';

const MODAL = 'modalUser';
const FILTROS: readonly FiltroDeUsuarios[] = ['activos', 'inhabilitados', 'sin-rol', 'todos'];

let miId = '';
let usuarios: UsuarioApp[] = [];
let filtro: FiltroDeUsuarios = 'activos';
let consulta = 0;
let modo: Modo = 'crear';
let seleccionado: UsuarioApp | null = null;
let datosDeAcceso = '';

const campo = <T extends HTMLElement>(id: string) => byId<T>(id);

function pintarEstado(texto: string | null, esError = false): void {
  const estado = byId('usersStatus');
  estado.textContent = texto ?? '';
  estado.classList.toggle('hidden', !texto);
  estado.classList.toggle('form-error', esError);
}

export async function cargarUsuarios(): Promise<void> {
  const numero = ++consulta;
  if (usuarios.length === 0) pintarEstado('Cargando usuarios…');
  const resultado = await listarUsuarios();
  if (numero !== consulta) return;
  if (!resultado.ok) {
    pintarEstado(resultado.error, true);
    return;
  }
  usuarios = resultado.data;
  pintarEstado(null);
  pintarLista();
}

function textoDeEstado(u: UsuarioApp): { texto: string; clave: string; detalle: string } {
  if (u.rol === null) return { texto: 'Sin rol', clave: 'sin-rol', detalle: 'No puede entrar hasta que le asignes un rol' };
  if (u.activo) return { texto: 'Activo', clave: 'activo', detalle: '' };
  const desde = u.inhabilitadoEn ? `desde ${formatearFechaHora(u.inhabilitadoEn)}` : '';
  return { texto: 'Inhabilitado', clave: 'inhabilitado', detalle: [desde, u.inhabilitadoPor ? `por ${u.inhabilitadoPor}` : ''].filter(Boolean).join(' ') };
}

function crearFila(u: UsuarioApp): DocumentFragment {
  const fila = clonarPlantilla('tpl-usuario-fila');
  const tr = ref(fila, 'fila');
  tr.dataset.id = u.id;
  tr.classList.toggle('is-inactive', u.rol !== null && !u.activo);
  ref(fila, 'nombre').textContent = u.id === miId ? `${u.nombre} (tú)` : u.nombre;
  ref(fila, 'correo').textContent = u.correo;

  const rol = ref(fila, 'rol');
  rol.textContent = nombreDeRol(u.rol);
  rol.dataset.rol = u.rol ?? 'ninguno';

  const estado = textoDeEstado(u);
  const chip = ref(fila, 'estado');
  chip.textContent = estado.texto;
  chip.dataset.estado = estado.clave;
  ref(fila, 'detalleEstado').textContent = estado.detalle;

  const ingreso = ref(fila, 'ingreso');
  ingreso.textContent = u.ultimoIngreso ? haceCuanto(u.ultimoIngreso, new Date()) : 'Nunca';
  if (u.ultimoIngreso) ingreso.title = formatearFechaHora(u.ultimoIngreso);

  const editar = ref<HTMLButtonElement>(fila, 'botonEditar');
  if (u.rol === null) editar.lastChild!.textContent = ' Asignar rol';

  const boton = ref<HTMLButtonElement>(fila, 'botonEstado');
  if (u.rol === null) {
    boton.remove();
  } else if (u.activo) {
    boton.textContent = 'Inhabilitar';
    boton.classList.add('btn-danger');
    const motivo = motivoParaNoInhabilitar(u, miId, usuarios);
    boton.disabled = motivo !== null;
    if (motivo) boton.title = motivo;
  } else {
    boton.textContent = 'Habilitar';
  }
  return fila;
}

function pintarLista(): void {
  const texto = campo<HTMLInputElement>('usersSearch').value;
  const visibles = filtrarUsuarios(usuarios, texto, filtro);
  const conteo = conteoDeUsuarios(usuarios);
  document.querySelectorAll<HTMLElement>('#usersView [data-filtro]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.filtro === filtro));
  });
  document.querySelectorAll<HTMLElement>('#usersView [data-conteo]').forEach((s) => {
    s.textContent = String(conteo[s.dataset.conteo as FiltroDeUsuarios] ?? 0);
  });

  const cuerpo = byId('usersList');
  if (visibles.length === 0) {
    const fila = crearElemento('tr', '');
    const celda = crearElemento('td', 'table-empty', texto.trim() ? 'Ningún usuario coincide con la búsqueda.' : 'No hay usuarios en esta lista.');
    celda.colSpan = 5;
    fila.append(celda);
    cuerpo.replaceChildren(fila);
    return;
  }
  cuerpo.replaceChildren(...visibles.map(crearFila));
}

// ---------------------------------------------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------------------------------------------

function pintarAvisoDeRol(): void {
  const rol = campo<HTMLSelectElement>('userRoleInput').value;
  let aviso: string | null = null;
  if (esRol(rol)) {
    if (modo === 'editar' && seleccionado) {
      aviso = motivoParaNoCambiarRol(seleccionado, rol, miId, usuarios) ?? (seleccionado.rol ? avisoDeCambioDeRol(seleccionado, rol) : null);
    } else if (modo === 'crear' && rol === 'tecnico') {
      aviso = 'Se le crea su ficha de técnico (o se reactiva la que tenga su mismo nombre) para poder planificarlo.';
    }
  }
  const pista = byId('userRoleHint');
  pista.textContent = aviso ?? '';
  pista.classList.toggle('hidden', !aviso);
}

function abrirFormulario(nuevoModo: Modo, usuario: UsuarioApp | null = null): void {
  modo = nuevoModo;
  seleccionado = usuario;
  const titulos: Record<Modo, string> = {
    crear: 'Nuevo usuario',
    editar: usuario?.rol === null ? 'Asignar rol' : 'Editar usuario',
    contrasena: 'Contraseña temporal'
  };
  byId(`${MODAL}-titulo`).textContent = titulos[modo];
  document.querySelectorAll<HTMLElement>(`#${MODAL} [data-modo]`).forEach((el) => {
    el.classList.toggle('hidden', !(el.dataset.modo ?? '').split(' ').includes(modo));
  });
  byId('userTarget').textContent = usuario ? `${usuario.nombre} · ${usuario.correo}` : '';
  campo<HTMLInputElement>('userEmailInput').value = '';
  campo<HTMLInputElement>('userNameInput').value = usuario?.nombre ?? '';
  campo<HTMLSelectElement>('userRoleInput').value = usuario?.rol ?? 'tecnico';
  campo<HTMLInputElement>('userPasswordInput').value = generarContrasenaTemporal();
  byId('btnUserSave').textContent = modo === 'crear' ? 'Crear usuario' : modo === 'contrasena' ? 'Cambiar contraseña' : 'Guardar';
  establecerError('userError', null);
  byId('formUser').classList.remove('hidden');
  byId('userAccess').classList.add('hidden');
  pintarAvisoDeRol();
  abrirModal(MODAL);
}

function mostrarAcceso(titulo: string, correo: string, contrasena: string): void {
  datosDeAcceso = textoDeAcceso(correo, contrasena, new URL(RUTAS.login, window.location.origin).href);
  byId('userAccessTitle').textContent = titulo;
  byId('userAccessData').textContent = datosDeAcceso;
  byId('formUser').classList.add('hidden');
  byId('userAccess').classList.remove('hidden');
}

async function guardar(): Promise<void> {
  const nombre = campo<HTMLInputElement>('userNameInput').value.trim();
  const rol = campo<HTMLSelectElement>('userRoleInput').value;
  const contrasena = campo<HTMLInputElement>('userPasswordInput').value;

  if (modo === 'crear') {
    const correo = campo<HTMLInputElement>('userEmailInput').value.trim().toLowerCase();
    const problema = problemaDeUsuarioNuevo({ correo, nombre, rol, contrasena }, usuarios.map((u) => u.correo));
    if (problema) return establecerError('userError', problema);
    const resultado = await crearUsuario({ correo, nombre, rol: rol as Rol, contrasena });
    if (!resultado.ok) return establecerError('userError', resultado.error);
    mostrarAcceso(`${nombre} ya puede entrar como ${nombreDeRol(rol as Rol)}`, correo, contrasena);
    mostrarAviso(`Usuario ${nombre} creado.`, 'exito');
    void cargarUsuarios();
    return;
  }

  const usuario = seleccionado;
  if (!usuario) return;

  if (modo === 'contrasena') {
    const problema = problemaDeContrasena(contrasena);
    if (problema) return establecerError('userError', problema);
    const resultado = await cambiarContrasena(usuario.id, contrasena);
    if (!resultado.ok) return establecerError('userError', resultado.error);
    mostrarAcceso(`Contraseña de ${usuario.nombre} cambiada`, usuario.correo, contrasena);
    mostrarAviso(`Contraseña temporal de ${usuario.nombre} lista.`, 'exito');
    return;
  }

  const problema = problemaDeDatos(nombre, rol) ?? motivoParaNoCambiarRol(usuario, rol as Rol, miId, usuarios);
  if (problema) return establecerError('userError', problema);
  const aviso = usuario.rol ? avisoDeCambioDeRol(usuario, rol as Rol) : null;
  if (aviso && !(await confirmar({ titulo: `Cambiar el rol de ${usuario.nombre} a ${nombreDeRol(rol as Rol)}`, mensaje: aviso, aceptar: 'Cambiar rol' }))) {
    return;
  }
  const resultado = await actualizarUsuario(usuario.id, nombre, rol as Rol);
  if (!resultado.ok) return establecerError('userError', resultado.error);
  cerrarModal(MODAL);
  mostrarAviso(`Cambios de ${nombre} guardados.`, 'exito');
  void cargarUsuarios();
}

// ---------------------------------------------------------------------------------------------------------------
// Inhabilitar / habilitar
// ---------------------------------------------------------------------------------------------------------------

async function alternarEstado(usuario: UsuarioApp, boton: HTMLElement): Promise<void> {
  if (usuario.activo) {
    const motivo = await pedirTexto({
      titulo: `Inhabilitar a ${usuario.nombre}`,
      mensaje:
        'Ya no podrá entrar al panel y se cierran sus sesiones abiertas. Si es técnico, sale de la planificación ' +
        'desde mañana. Su historial se conserva y puedes habilitarlo de nuevo.',
      etiqueta: 'Motivo (queda en la bitácora)',
      placeholder: 'Ej: dejó la empresa',
      maxLength: 500,
      aceptar: 'Inhabilitar'
    });
    if (motivo === null) return;
    const resultado = await inhabilitarUsuario(usuario.id, motivo);
    if (!resultado.ok) return mostrarAviso(resultado.error, 'error');
    mostrarAviso(`${usuario.nombre} quedó inhabilitado.`, 'exito');
    const casos = avisoDeCasosAbiertos(usuario.nombre, resultado.data);
    if (casos) mostrarAviso(casos, 'info');
  } else {
    const ok = await confirmar({
      titulo: `Habilitar a ${usuario.nombre}`,
      mensaje: 'Vuelve a entrar con su contraseña anterior (o ponle una temporal). Si es técnico, hay que planificarlo de nuevo.',
      aceptar: 'Habilitar',
      ancla: boton
    });
    if (!ok) return;
    const resultado = await habilitarUsuario(usuario.id);
    if (!resultado.ok) return mostrarAviso(resultado.error, 'error');
    mostrarAviso(`${usuario.nombre} puede volver a entrar.`, 'exito');
  }
  await cargarUsuarios();
}

export function iniciarUsuarios(usuarioActual: string): void {
  miId = usuarioActual;

  byId('btnUsersRefresh').addEventListener('click', () => void cargarUsuarios());
  byId('btnUserNew').addEventListener('click', () => abrirFormulario('crear'));
  campo<HTMLInputElement>('usersSearch').addEventListener('input', pintarLista);
  document.querySelectorAll<HTMLElement>('#usersView [data-filtro]').forEach((b) => {
    b.addEventListener('click', () => {
      filtro = FILTROS.find((f) => f === b.dataset.filtro) ?? 'activos';
      pintarLista();
    });
  });

  byId('usersList').addEventListener('click', (evento) => {
    const boton = (evento.target as Element).closest<HTMLButtonElement>('[data-action]');
    const id = boton?.closest<HTMLElement>('tr')?.dataset.id;
    const usuario = usuarios.find((u) => u.id === id);
    if (!boton || !usuario || boton.disabled) return;
    if (boton.dataset.action === 'editar-usuario') abrirFormulario('editar', usuario);
    if (boton.dataset.action === 'contrasena-usuario') abrirFormulario('contrasena', usuario);
    if (boton.dataset.action === 'alternar-usuario') void alternarEstado(usuario, boton);
  });

  campo<HTMLSelectElement>('userRoleInput').addEventListener('change', pintarAvisoDeRol);
  byId('btnUserGeneratePassword').addEventListener('click', () => {
    campo<HTMLInputElement>('userPasswordInput').value = generarContrasenaTemporal();
  });
  byId('btnUserCopyAccess').addEventListener('click', async () => {
    const ok = await copiarAlPortapapeles(datosDeAcceso);
    mostrarAviso(ok ? 'Datos de acceso copiados.' : 'No se pudo copiar: selecciónalos y cópialos a mano.', ok ? 'exito' : 'error');
  });

  let guardando = false;
  byId('formUser').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (guardando) return;
    guardando = true;
    const boton = byId<HTMLButtonElement>('btnUserSave');
    boton.disabled = true;
    try {
      await guardar();
    } finally {
      guardando = false;
      boton.disabled = false;
    }
  });
}
