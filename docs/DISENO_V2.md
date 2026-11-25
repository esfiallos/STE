# Diseño v2 · Dispatch, Técnicos y Traspasos

Rama de trabajo: **`desarrollo`** (nunca directo en `main`).
Este documento traduce el requerimiento a cambios concretos sobre la arquitectura actual
(ver `CLAUDE.md`). Las decisiones abiertas están al final.

---

## 1. Qué hay hoy y qué falta

| Requerimiento | Estado actual | Brecha |
|---|---|---|
| Dashboard de asignación del día (dispatch) | ✅ Tablero turnos → técnicos → INC, Realtime | Filtro por técnico |
| Bitácora de modificaciones | ✅ Triggers en BD | Registrar también traspasos, etiquetas, última actualización |
| Guardar el estado final del día | ✅ `generar_snapshot_diario()` 23:59 | Cambiar hora/criterio al **día operativo** (§2) |
| Turno **por día**, no por técnico | ❌ `tecnicos.turno` es fijo | Planificación diaria del dispatch (§3.2) |
| Tablero limpio a las 06:00 | ❌ Los INC viven hasta que se borran | Día operativo 06:00 → 06:00 (§2) |
| Búsqueda global de todos los casos y quién los llevó | ⚠ Solo snapshots + bitácora (texto) | Casos persistentes + historial de responsables (§3.3) |
| Animaciones / feedback visual de dónde pasan las cosas | ⚠ Toast y sonido | Capa transversal de efectos (§6) |
| Login: "olvidé mi contraseña" | ❌ | Flujo de recuperación de Supabase (§5.1) |
| Roles dispatch / técnico | ❌ Todos editan; "Modo Consulta" manual | Tabla `perfiles` + RLS por rol; se elimina Modo Consulta |
| Vista del técnico: sus tickets del día | ❌ | Módulo técnico (§5.2) |
| Notificaciones y alertas de asignación | ❌ (sonido local) | Tabla `notificaciones` + Realtime (§3.5) |
| Seguimiento (nuevos + en traspaso) | ❌ | Vista de seguimiento (§5.2) |
| Traspasos al final del turno | ❌ (existe en `traspasos-noc` sobre Excel) | Módulo de traspasos sobre datos de la BD (§5.3) |
| Estados (En curso, Pausado, Resuelto, Cerrado) + etiquetas (Crítico, Monitoreo, Pendiente) + nota personalizada | ❌ | Campos en caso / ítem de traspaso |
| "Última actualización" por caso | ❌ | Campo de texto corto + fecha (§3.3) |
| Exportar: texto enriquecido (Outlook), texto plano, Excel | ❌ | Portar `report.js` de `traspasos-noc` a `domain/` |

---

## 2. Concepto central: el **día operativo**

- Un día operativo empieza a las **06:00** (hora de Honduras) y termina a las 06:00 del día siguiente.
- Turnos dentro del día operativo `D`:
  - **A** 06:00–14:00 · **B** 14:00–22:00 · **C** 22:00–06:00 (D → D+1).
  - **Comodín**: horario elegido de una lista fija: **06:00–16:00 · 07:00–17:00 · 08:00–18:00**
    (constante `HORARIOS_COMODIN` en `domain/shifts.ts`).
  - **Almuerzo**: lo define el dispatch para cada técnico en la planificación del día.
- Entre 00:00 y 05:59 la fecha operativa sigue siendo la de **ayer** (es el turno C).
- El tablero muestra solo las asignaciones de la fecha operativa actual ⇒ a las 06:00 queda **limpio sin
  borrar nada**: los datos de ayer siguen en la BD para historial y búsqueda.
- Función pura nueva: `fechaOperativa(ahora: Date): string` en `domain/time.ts` (+ equivalente SQL).

**Destino de un traspaso** (a quién puedo traspasar al terminar mi turno; el técnico elige caso por caso
entre los técnicos con jornada en esos turnos):

| Termino turno | Puede traspasar a | Fecha operativa del receptor |
|---|---|---|
| A | B · Comodín | mismo día (D) |
| B | C | mismo día (D) |
| B | A · Comodín | siguiente día (D+1) |
| Comodín | C | mismo día (D) |
| Comodín | A · Comodín | siguiente día (D+1) |
| C | A · Comodín | siguiente día (D+1) |

- Regla pura en `domain/handover.ts` → `destinosDeTraspaso(turnoOrigen, fecha)`; la misma regla se valida
  en SQL dentro de `enviar_traspaso` (la UI no es la única barrera).
- Como B, C y Comodín traspasan al **día siguiente**, el traspaso solo ofrece técnicos **ya planificados**
  para D+1. Eso lo garantiza la planificación semanal (D5); si D+1 no tiene a nadie en A/Comodín, la
  pantalla de traspaso lo avisa y no deja cerrar turno hasta que el dispatch lo planifique.

---

## 3. Modelo de datos (migración `sql/04_v2_modelo_base.sql`, idempotente) — ✅ Fase 1

> **Estado:** implementada y probada (`tests/sql/modelo-v2.test.ts`). Es **aditiva**: no borra
> `incidentes` ni `tecnicos.turno`, así la app actual sigue funcionando en DEV. El paso 9 copia el turno de
> hoy a `jornadas` y los incidentes a `casos` (re-ejecutarla copia solo lo que falte).
>
> **Corte (fase 2, `sql/05_v2_corte.sql`) — ✅ hecho:** resincroniza lo que la app anterior cambió después
> de la 04 (casos nuevos, reasignados y cerrados), borra `incidentes` y el turno fijo de `tecnicos`, RLS de
> `tecnicos` solo dispatch, vista `casos_abiertos`, cron del snapshot operativo a las 05:59. `03_datos_demo_dev.sql`
> reescrito: ya no vacía `perfiles`. Pruebas: `tests/sql/corte-v2.test.ts`.

### 3.1 Usuarios y roles
```
perfiles (id uuid PK = auth.users.id, nombre, rol 'dispatch'|'tecnico', tecnico_id uuid unique null → tecnicos)
```
- Helpers SQL: `es_dispatch()`, `mi_tecnico_id()` (security definer, stable) para usar en RLS.
- Un técnico (usuario) solo lee el tablero y edita **sus** casos; el dispatch edita todo.

### 3.2 Técnicos y turno del día
- `tecnicos`: se elimina `turno` y el horario de comodín (pasa al día). Queda: nombre, activo.
- Nueva `jornadas` (una fila por técnico y fecha; la arma el dispatch en la **planificación semanal**):
```
jornadas (fecha_operativa date, tecnico_id, turno 'turnoA'|'turnoB'|'turnoC'|'comodin',
          horario_inicio, horario_fin (solo comodín), almuerzo_inicio, almuerzo_fin,
          unique (fecha_operativa, tecnico_id))
```
- Toda la lógica actual de `domain/shifts.ts` y `availability.ts` sigue igual, pero recibe la **jornada**
  en lugar del técnico. Cambio acotado.
- Migración de datos: el `turno` actual de cada técnico se copia como su jornada de hoy.

### 3.3 Casos persistentes (sustituye a `incidentes`)
```
casos (id, codigo unique normalizado, cliente, area, descripcion, nota,
       estado 'en_curso'|'pausado'|'resuelto'|'cerrado', etiqueta, tecnico_actual_id,
       ultima_actualizacion text, ultima_actualizacion_en timestamptz, ultima_actualizacion_por,
       creado_en, creado_por)

caso_responsables (caso_id, tecnico_id, fecha_operativa, origen 'dispatch'|'traspaso'|'reasignacion',
                   desde timestamptz, hasta timestamptz null)
```
- **Estados:** En curso · Pausado · Resuelto · Cerrado. Solo **Cerrado** saca el caso del flujo; *Resuelto*
  sigue vivo (p. ej. en monitoreo) y se traspasa como los demás.
- **Nunca se borran casos**: se cierran. "Eliminar" del dispatch = corrección (se registra en bitácora).
- El tablero del día = responsables con `fecha_operativa = hoy` y `hasta is null`.
- Búsqueda global = `casos` + `caso_responsables` (quién lo llevó y cuándo), sin depender de snapshots.
- "Última actualización": un solo campo de texto corto que el técnico escribe; la BD guarda quién y cuándo.
  **Reemplazado por D19 (§11.3):** la última actualización pasa a ser solo una **fecha**; el texto vive en la
  **descripción** del caso.

### 3.4 Traspasos
```
traspasos (id, de_tecnico_id, fecha_operativa, turno_origen, estado 'borrador'|'enviado', enviado_en)
traspaso_items (traspaso_id, caso_id, para_tecnico_id, etiqueta, nota_personalizada, ultima_actualizacion)
```
- RPC `enviar_traspaso(id)` en **una transacción**: valida que **todos** mis casos no cerrados estén en el
  traspaso con receptor y última actualización (mi carga queda en 0; si no, se rechaza), cierra el responsable actual, abre el del receptor (`origen = 'traspaso'`) con la fecha
  operativa del destino (§2), crea notificaciones y entrada en bitácora.

### 3.5 Notificaciones
```
notificaciones (id, tecnico_id, tipo 'asignado'|'traspaso'|'reasignado', caso_id, leida, creado_en)
```
- Las escribe un trigger (al abrir un responsable). La app solo lee y marca como leídas (RLS: solo las mías).
- Realtime sobre `notificaciones` ⇒ alerta visual + sonido en la sesión del técnico.

### 3.6 Snapshot
- `generar_snapshot_diario()` pasa a recibir la fecha operativa y se basa en `casos` + `jornadas`.
- Hora del cron: ver decisión abierta D1.

---

## 4. Arquitectura de la app (se mantienen las capas)

```
src/pages/
  index.astro          → redirige según rol
  login.astro          (+ recuperar contraseña)
  restablecer.astro    nueva: fijar contraseña nueva desde el enlace del correo
  dispatch.astro       tablero editable · planificación del día · bitácora · historial · búsqueda global
  tecnico.astro        mi día · seguimiento · notificaciones · traspaso · búsqueda global
src/domain/            + operativeDay.ts, handover.ts (reglas de traspaso), report.ts (Outlook/TSV), tags.ts
src/services/          + perfilRepo, jornadasRepo, casosRepo, traspasosRepo, notificacionesRepo
src/scripts/           + planning/, followUp/, handover/, notifications/, globalSearch/, ui/motion.ts
```
- El **rol se decide en la BD** (RLS); la UI solo esconde controles. Un técnico que manipule la página
  no puede escribir lo que no le corresponde.
- Se elimina `features/readOnlyMode.ts` (Modo Consulta): lo reemplaza el rol.
- `report.js` / `sorting.js` / `clipboard.js` de `traspasos-noc` se portan a TS (`domain/report.ts`,
  `scripts/ui/clipboard.ts` ya existe). Los parsers de Excel **no** se necesitan.

---

## 5. Módulos

### 5.1 Login — ✅ Fase 3
- "¿Olvidaste tu contraseña?" → `supabase.auth.resetPasswordForEmail(correo, { redirectTo: <base>/restablecer/ })`.
- `/restablecer/` → `supabase.auth.updateUser({ password })`.
- Requiere en Supabase (DEV y PROD): *Authentication → URL Configuration → Redirect URLs* con esa ruta.
- Mejoras visuales: estados de carga, errores en línea, transición de entrada.
- Hecho: panel "¿Olvidaste tu contraseña?" dentro del login (no revela si el correo existe; avisa si se pide
  otro enlace demasiado pronto), página `/restablecer/` (detecta enlace vencido o abierto sin enlace, valida
  8+ caracteres con letras y números, quita el token de la dirección y entra al panel), mostrar/ocultar
  contraseña, aviso de Bloq Mayús, botón con indicador de carga, sacudida al fallar, animación de entrada
  (se apaga con "reducir movimiento"). Configuración de Supabase: `docs/ENTORNOS_Y_DESPLIEGUE.md` §1, pasos 7 y 8.

### 5.2 Técnico — ✅ Fase 4

> Hecho: pestaña **Mi seguimiento** (vista por defecto del técnico) con *Recibidos en traspaso* (incluye los
> del próximo turno), *Nuevos de hoy* y *De días anteriores*; por caso: estado (cerrar pide confirmación), etiqueta
> (sugeridas o propia), última actualización (Guardar o Ctrl+Enter), historial de responsables, copiar código o
> resumen; "Copiar todos" en texto. Campana con no leídas, lista, marcar leída/todas, aviso + sonido en tiempo
> real y alertas de escritorio opcionales. Su columna se resalta en el tablero. `sql/06_v2_seguimiento.sql` agrega
> `origen_responsable` a `casos_abiertos`.

- **Mi día**: versión de solo lectura del tablero del día, con mis casos resaltados y copiar código en 1 clic.
- **Seguimiento**: mis casos abiertos agrupados en *Nuevos hoy* · *Recibidos en traspaso*;
  cada uno con estado, etiqueta, última actualización (edición rápida en línea) e historial de responsables.
- **Notificaciones**: campana con contador, panel con lista, alerta (toast + sonido + resaltado del caso).

### 5.3 Traspasos (adaptación de `traspasos-noc`)
1. Toma automáticamente **todos mis casos abiertos** (nuevos + recibidos).
2. Pool de receptores = técnicos con jornada en el turno destino (§2).
3. Por caso: receptor, estado (En curso · Pausado · Resuelto · Cerrado), etiqueta (Crítico, Monitoreo,
   Pendiente, …), nota personalizada que se adjunta a la descripción, última actualización (obligatoria).
4. Balanceo automático con candados (se porta `balancer.js`) y "Deshacer".
5. Vista previa → copiar **texto enriquecido para Outlook**, **texto plano** o **TSV/Excel**.
6. **Cerrar turno = enviar el traspaso.** El sistema **impide cerrar turno** mientras quede algún caso no
   *Cerrado* sin receptor: la carga propia debe quedar en **0**. Los marcados *Cerrado* no se traspasan.
7. Al enviar (RPC `enviar_traspaso`) los casos pasan al receptor y aparecen en su Seguimiento como
   "Recibidos en traspaso".

### 5.4 Dispatch
- **Planificación semanal**: el lunes (día 1 de jornada) el dispatch arma la semana completa en una grilla
  técnico × día: turno (A, B, C o Comodín con su horario de la lista) y almuerzo. Atajos: copiar la semana
  anterior, copiar un día a otro.
- **Revisión del día** (al inicio, 06:00): la planificación de hoy aparece para confirmarla o ajustarla por
  eventualidades (ausencias, cambios de turno, almuerzos). Los cambios quedan en la bitácora.
- Tablero actual + **filtro por técnico**.
- **Búsqueda global**: todos los casos alguna vez creados, estado, responsable actual e historial.

---

## 6. Feedback visual (transversal)
- Caso nuevo/movido: animación de entrada y destello en la columna destino (técnica FLIP al reasignar).
- Columna que recibe un drag: realce; contador de la tarjeta con "pop" al cambiar.
- Notificación: badge animado y desplazamiento al caso.
- Todo en `scripts/ui/motion.ts` + parciales SCSS; respeta `prefers-reduced-motion`.

---

## 7. Plan por fases (cada fase = PR a `desarrollo`, con pruebas)

| Fase | Contenido | Depende de |
|---|---|---|
| **1. Base de datos v2** ✅ | `perfiles`, `jornadas`, `casos`, `caso_responsables`, RLS por rol, día operativo, migración de datos, snapshot, pruebas SQL | — |
| **2. Dispatch v2** ✅ | Planificación semanal + revisión del día, tablero por fecha operativa, filtro por técnico, quitar Modo Consulta, enrutamiento por rol, corte (`05`) | 1 |
| **3. Login** ✅ | Recuperar/restablecer contraseña, pulido visual | — (paralelo) |
| **4. Técnico** ✅ | Mi día, Seguimiento, última actualización, notificaciones + alertas (`06`) | 1, 2 |
| **5. Casos + Traspasos** ✅ | §10.1 (áreas, campos del técnico, actividad) + armado, balanceo, etiquetas (+VM), recordatorio por fecha, export Outlook/TSV, envío transaccional, **Mis traspasos** (§10.4–10.6) | 4 |
| **6. Coordinador** ✅ | Rol nuevo, buscador global (absorbe la antigua fase "Búsqueda global"), panel de estadísticas, alertas 2/4/6 h (§10.3) | 5 |
| **7. Ronda** ✅ | Botón "Asignar a la ronda" del dispatch, rotativa alfabética por turno (§10.2) | 5 |
| **8. Planificación con solicitudes** ✅ | Dispatch en solo lectura + solicitud de edición por día; planificación completa para coordinación (§10.7) | 6 |
| **9. Animaciones** ✅ | Capa de efectos y pulido | 2, 4 |

| **10. Tablero del día** ✅ | Tablero y panel = solo lo asignado hoy por dispatch (vacío a las 06:00), Cancelar y Editar del dispatch en lugar de cerrar, empresa al crear, bitácora solo supervisión (§11.1–11.2, §11.12) · `11` | 9 |
| **11. Base visual** ✅ | Inter + paleta navy, panel de confirmación, selector de fecha rápido, combobox, auto-animate + Motion (§11.7–11.10) | — (paralelo a 10) |
| **12. Seguimiento v2** ✅ | Descripción única + "Última actualización" como fecha y botón, filas horizontales, etiquetas locales con combobox, nota del traspaso = descripción, verificación traspaso → seguimiento (§11.3–11.6) · `12` | 10, 11 |
| **13. Filtros** ✅ | Tipo de caso (FRESH · Tarea · Incidente) y filtros por técnico, área, estado y tipo en todas las vistas de casos (§11.11) | 12 |
| **14. Turno C por tramos y pulido** ✅ | C1 22–00 / C2 00–06 (D29), color de la tabla del traspaso (D30), destello al soltar un caso, tarjetas sin chips superpuestos, quedarse un caso para mañana (D31) (§12) · `14`, `15` | 13 |
| **17. Reparto por supervisión** ✅ | Dispatch y coordinación reparten "Por reasignar" al seguimiento de otros técnicos (D37), el turno limita "Entregar a", buscadores que vuelven al estado normal (§15) · `17` | 16 |
| **16. Traspaso y colores** ✅ | Etiquetas "en manos de quién" (D36), estado y área con color, recordatorio opcional, receptor por turno con búsqueda y reparto "todos entran", historial en Buscar casos (también para el técnico) (§14) · sin SQL | 15 |
| **15. Seguridad y casos perdidos** ✅ | Lectura solo con perfil (D32), turno terminado sin traspaso → "Por reasignar" + alerta (D33), aviso previo al técnico (D34), filtro y orden por tiempo sin actualizar, CSP + SRI (D35) (§13) · `16` | 14 |

> Orden revisado el 19/11/2026 al sumar los requerimientos de §10. Cada fase con su migración `sql/0N_*.sql`.
> Fases 10–13 sumadas el 21/11/2026 (§11, calidad de vida).

---

## 8. Decisiones tomadas
- **D1. Snapshot:** a las **05:59**, cierre del día operativo (incluye el turno C).
- **D2. Fin de turno:** todo caso que no esté *Cerrado* **debe** traspasarse; no se puede cerrar turno con
  carga propia distinta de 0. No existen casos "arrastrados" sin traspaso.
- **D3. Rol dispatch:** se otorga **solo por SQL** (administrador). No hay pantalla de usuarios.
- **D4. Roles separados:** un dispatch no tiene casos propios ni Seguimiento.
- **D5. Planificación:** es **semanal**. El dispatch arma la semana el lunes y cada mañana revisa el día
  por eventualidades. El traspaso solo ofrece receptores ya planificados.
- **D6. Destinos de traspaso:** A → B/Comodín (mismo día) · B → C (mismo día) o A/Comodín (día siguiente) ·
  Comodín → C (mismo día) o A/Comodín (día siguiente) · C → A/Comodín (día siguiente).
- **D7. Comodín:** horarios fijos 06–16, 07–17, 08–18. Almuerzos a elección del dispatch.
- **D8–D15** (19/11/2026): ver §10. Cambian D3 (hay un tercer rol, **coordinador**) y D5 (la planificación la
  hace coordinación; el dispatch solo la edita por día con solicitud aprobada).
- **D37** (23/11/2026): ver §15. Cambia D16/D18 en lo que toca a "Por reasignar": coordinación también la ve y reparte.
- **D36** (23/11/2026): ver §14. Cambia D22 (etiquetas sugeridas) y da Buscar casos al técnico.
- **D32–D35** (23/11/2026): ver §13. Matizan D2: si un técnico no cierra turno, el caso no se pierde: la base lo
  detecta 30 min después del fin del turno y lo devuelve al dispatch ("Por reasignar") y a coordinación (alerta).
- **D29–D31** (22/11/2026): ver §12. Cambian D6 (los tramos de C cuentan como "turno C"; uno puede entregarse a sí
  mismo para su turno de mañana) y D2 (la carga en 0 cuenta solo los casos de hoy).
- **D16–D28** (21/11/2026): ver §11. D25 es la única excepción a "los casos no se borran" (Cancelar del dispatch). Cambian D8 (el dispatch crea con código + **empresa**), D9 (la actividad del
  técnico **es** la "última actualización", ahora una fecha) y §3.3 (el texto del caso es la **descripción**).

---

## 9. Fase 2 en la app (qué cambió) y orden de despliegue

**En la app**
- Al entrar se lee el perfil: **dispatch** edita; **técnico** ve el tablero en solo lectura (hasta la fase 4);
  sin perfil, pantalla "Tu usuario aún no tiene un rol". Desaparece el botón Modo Consulta.
- Tablero = técnicos con jornada en la **fecha operativa** + casos abiertos de ese día. Arriba, la franja
  **Por reasignar**: casos abiertos cuyo responsable no trabaja hoy (se arrastran a un técnico disponible).
- **Filtro por técnico** en la barra, y el día operativo visible.
- "Quitar" un caso ahora lo **cierra** (no lo borra). Asignar un código cerrado ofrece **reabrirlo**.
- **Gestionar técnicos**: solo nombre; activar/desactivar en lugar de eliminar.
- Pestaña **Planificación** (solo dispatch): semana lunes–domingo, turno por celda (comodín con su horario),
  almuerzo por celda, días pasados bloqueados, cobertura por día, **Copiar semana anterior**.

**Orden de despliegue (DEV primero, después PROD)**
1. `05_v2_corte.sql` y luego `06_v2_seguimiento.sql` en la base (la 04 ya debe estar aplicada).
2. Crear los perfiles: el tuyo como `dispatch` y los técnicos con su `tecnico_id`. Sin perfil, el usuario no
   entra al panel.
3. DEV: opcionalmente `03_datos_demo_dev.sql` y probar con `bun run dev`.
4. PROD: hacer 1 y 2 **justo antes** de unir `desarrollo` → `main` (el despliegue tarda unos minutos y en ese
   intervalo la app publicada anterior deja de funcionar, porque ya no existe `incidentes`).
5. Revisar en Planificación la semana en curso: la 05 solo crea la jornada de **hoy** a partir del turno fijo.

---

## 10. Requerimientos v2.1 (19/11/2026)

Reglas nuevas pedidas por el usuario. Las decisiones D8–D15 ya están tomadas: no re-preguntarlas.
Lo marcado como **Supuesto** es criterio propio para completar la regla; confirmarlo al implementar la fase.

### 10.1 Datos del caso: quién llena qué (fase 5) — ✅ `sql/07_v2_traspasos.sql`
- **D8.** El **dispatch** crea el caso solo con **código + nota** (la nota suele llevar empresa e ID de enlace).
  Su tablero muestra solo incidente, nota y técnico. **Cambiado por D18 (§11.2):** código + **empresa**.
- El **técnico** registra en **sus** casos: **área**, **empresa** (`casos.cliente`), estado, etiqueta y
  última actualización. Hay que abrir `area` y `cliente` en el trigger `casos_antes_de_guardar` (hoy los bloquea).
- El **coordinador** solo lee todos los campos.
- **Áreas (catálogo fijo):** CPE · PLEX · TX · CORE CS · CORE IP · CORE PS · SIO · SOPORTE DIGITAL · FRESH ·
  REDPRO · PVR · REGIONAL · COMERCIAL. La constante va en `domain/` y el check en SQL, con una prueba que verifica
  que coincidan. Los casos existentes con otra área (en DEV hay demo: "DATACENTER", "ENLACES B2B"…) se dejan en
  `null` en la migración, y antes se copian a la bitácora.
- **D9. Actividad del técnico:** toda edición del técnico sobre su caso (estado, etiqueta, área, empresa,
  última actualización) cuenta como actualización. Columna nueva `casos.actividad_tecnico_en`, que escribe el
  trigger. Es la referencia de las alertas (§10.3).

### 10.2 Asignar a la ronda (fase 7) — ✅ `sql/09_v2_ronda.sql`
- Junto al botón actual (asignar a un técnico concreto), el dispatch tiene **"Crear y asignar a la ronda"**:
  crea el caso y lo asigna al **siguiente técnico de la ronda**.
- **D10. Ronda rotativa alfabética por turno:** candidatos = técnicos **disponibles ahora** (en horario y fuera
  de almuerzo, `domain/availability.ts`) ordenados por nombre (orden español, sin acentos ni mayúsculas). Se
  recuerda quién recibió el último caso de la ronda **en el turno actual** (A 06–14, B 14–22, C 22–06) y se
  asigna al siguiente en orden; al final se vuelve al primero. El puntero se reinicia al empezar cada turno.
- La elección se hace en SQL (RPC `asignar_a_ronda(codigo, nota)` con bloqueo de la fila del puntero, tabla
  `ronda_estado(fecha_operativa, turno, ultimo_tecnico_id)`) para que dos dispatch a la vez no le den el caso al
  mismo técnico. Misma regla pura en `domain/` con prueba de coincidencia.
- **Supuesto:** la asignación manual a un técnico concreto **no** mueve el puntero. Los comodines participan
  mientras estén en horario. Si nadie está disponible, error claro y no se crea el caso.
- Implementado: el puntero guarda el **nombre** del último; si esa persona ya no está disponible (almuerzo, fin de
  turno), el caso va a quien sigue después de ella en el orden. La ronda solo crea casos nuevos: un código que ya
  existe (abierto o cerrado) se asigna o reabre con "Asignar al técnico". El modal muestra el siguiente como vista
  previa; la elección real la hace `asignar_a_ronda()` en la base (con el puntero bloqueado).

### 10.3 Rol Coordinador (fase 6) — ✅ `sql/08_v2_coordinador.sql`
- **D11.** Tercer rol `coordinador` (se otorga por SQL, igual que dispatch; sin `tecnico_id`). Helper
  `es_coordinador()`. Lee todo: casos, responsables, jornadas, traspasos e ítems, notificaciones de sistema y bitácora.
- **Buscador global:** todos los casos alguna vez creados (código, empresa, área, nota, estado, etiqueta, última
  actualización con autor y hora, responsable actual e historial de responsables y traspasos con su nota).
  Función SQL `buscar_casos(termino)` + ficha del caso. Absorbe la antigua fase 6 "Búsqueda global";
  **Supuesto:** también se ofrece al dispatch, en solo lectura.
- **Panel principal:** total de tickets del día operativo (casos con responsable en la fecha de hoy) y cantidad
  por estado (En curso · Pausado · Resuelto · Cerrado). En tiempo real.
- **D12. Alertas por falta de actualización:** 3 niveles, a las **2 h, 4 h y 6 h** sin actividad del técnico.
  Referencia = la más reciente entre `actividad_tecnico_en` y la hora en que el responsable actual recibió el
  caso. Las genera pg_cron cada 5 min en una tabla nueva (`alertas_coordinacion`: caso, técnico, nivel, desde,
  leída), una por caso y nivel desde esa referencia; una actualización nueva reinicia el conteo. Llegan a la
  campana del coordinador (Realtime + sonido + alerta de escritorio opcional).
  **Supuesto:** solo cuentan los casos no cerrados cuyo responsable **está en su turno**; las horas fuera de
  turno no suman (un caso recibido para el turno siguiente no alerta antes de que ese turno empiece).
- Implementado así: referencia = lo más reciente entre `actividad_tecnico_en`, la recepción del caso y el inicio del
  turno de hoy; solo se evalúa entre `inicio_de_turno()` y `fin_de_turno()`. Una actualización nueva (o cerrar o
  reasignar el caso) deja leídas las alertas anteriores. "Leída" es compartida por todos los coordinadores.
  La campana y el panel muestran una alerta por caso (la de más horas); abrirla atiende las del caso y lo abre en
  el buscador.

### 10.4 Etiqueta VM (fase 5) — ✅
- Se suma **VM** a las etiquetas sugeridas (`ETIQUETAS_SUGERIDAS`): indica que al caso se le programó una VM.

### 10.5 Recordatorio con fecha en el traspaso (fase 5) — ✅
- **D13.** En cada ítem del traspaso se puede dejar un **recordatorio** con **fecha** y texto (p. ej. "VM
  programada"). Al enviar, el recordatorio se guarda en el **caso** (sigue al caso aunque cambie de manos).
- El aviso llega **al inicio del turno** del técnico que tenga el caso ese día (inicio de su jornada de esa
  fecha; para comodín, su `horario_inicio`). Lo genera pg_cron cada 5 min como notificación de tipo
  `recordatorio`.
- **Supuesto:** si ese día el responsable no tiene jornada, el aviso sale a las 06:00 y además se muestra al
  coordinador (esto último, en la fase 6).
- Implementado: `inicio_de_turno(tecnico, fecha)` + `generar_recordatorios(ahora)` (pg_cron `recordatorios-traspaso`,
  cada 5 min). Cambiar la fecha o el texto lo vuelve a dejar pendiente. `enviar_traspaso` rechaza un recordatorio
  con texto sin fecha o con fecha pasada.
- `traspaso_items.fecha_destino` (lo escribe `enviar_traspaso`) permite listar lo recibido por día.

### 10.6 Mis traspasos (fase 5) — ✅
- Panel del técnico para consultar sus traspasos por **fecha**: los que **envió** (a quién pasó cada caso, con
  estado, etiqueta, nota y última actualización) y los que **recibió**. Desde ahí puede volver a copiar el
  reporte (Outlook, texto, TSV). Solo lectura.

### 10.7 Planificación con solicitudes (fase 8) — ✅ `sql/10_v2_planificacion.sql`
- **D14.** Para el **dispatch** la planificación pasa a **solo lectura**. Para editar un día concreto envía una
  **solicitud a coordinación** con fecha y **motivo** (p. ej. falta de un técnico). Si coordinación la aprueba,
  ese día (solo ese) queda editable para el dispatch. Tabla `solicitudes_planificacion` (fecha_operativa,
  motivo, solicitante, estado pendiente/aprobada/rechazada, resuelta_por, resuelta_en). La campana avisa al
  coordinador al llegar una y al dispatch con la respuesta.
- La **planificación completa** (semana, copiar semana anterior, etc.) vive en la versión del **coordinador**.
- **D15.** Nadie edita días pasados: solo **hoy en adelante**. Una semana ya pasada es inmutable (sus casos ya
  se traspasaron). Lo impone la BD (RLS + trigger en `jornadas`), no solo la UI.
- **Supuesto:** una aprobación vence al terminar ese día operativo.
- Implementado: "ese día operativo" = el día en que coordinación **aprueba** (vence a las 06:00 siguientes), así una
  aprobación para un día futuro no queda abierta varios días. El almuerzo cuenta como planificación (necesita el
  permiso). La aprobación habilita al rol dispatch (cualquier usuario dispatch). Una solicitud pendiente de un día
  que ya pasó queda como "Sin responder". Avisos: la campana de coordinación suma las solicitudes por responder; el
  dispatch tiene una campana propia con las respuestas (y aviso en pantalla al llegar).

---

## 11. Requerimientos v2.2 · calidad de vida (21/11/2026)

Revisión del usuario sobre DEV con los tres roles. D16–D28 son reglas **ya decididas** por el usuario: no
re-preguntarlas. Lo marcado **Supuesto** es criterio propio; lo marcado **Pendiente (Pn)** se confirma con el
usuario al empezar la fase que lo usa.

### 11.1 El tablero es el panel **del día** (fase 10) — ✅ `sql/11_v2_tablero_del_dia.sql`
- **Problema hoy:** `casosDelTablero()` muestra todo caso abierto cuyo responsable tiene `fecha <= hoy`, así que
  a las 06:00 el tablero ya trae lo de días anteriores y lo recibido en traspaso. `estadisticas_del_dia()` cuenta
  cualquier caso con un responsable en la fecha (incluye traspasos). Ninguno de los dos empieza vacío.
- **D16. Tablero del día = asignaciones del dispatch en el día operativo.** Para cualquier rol (dispatch, técnico,
  coordinación) el tablero de `D` muestra solo los casos que el dispatch **asignó** en `D` (responsables con
  `origen in ('dispatch', 'reasignacion', 'reapertura')` y `fecha_operativa = D`, incluida la ronda). A las 06:00
  está **vacío**. Lo recibido en traspaso y lo arrastrado de días anteriores vive en **Mi seguimiento**, no en el
  tablero.
- El caso se queda en el tablero todo el día aunque cambie de estado (se ve su estado; un cerrado queda atenuado):
  el tablero es el registro del día y su foto la guarda `generar_snapshot_operativo()` a las 05:59.
- **Confirmado (21/11):** el tablero general es **solo** de los casos del día. El caso aparece en la columna de a
  quién se lo asignó el dispatch (una reasignación por arrastre lo mueve); un traspaso posterior **no** cambia el
  tablero. Los casos nuevos **y** los traspasados se trabajan en **Mi seguimiento**.
- **D17. El panel de coordinación** (`estadisticas_del_dia`) cuenta exactamente los casos de D16, por estado
  actual. Misma regla en SQL (`casos_del_dia(fecha)`) y TS (`domain/assignments.ts`), con prueba de coincidencia.
- "Por reasignar" sigue existiendo para el dispatch, pero **fuera** del tablero y de los contadores (franja aparte,
  colapsable): son casos abiertos cuyo responsable no trabaja hoy.
- Implementado: vista `tablero_del_dia` (una fila por caso y día operativo con la última asignación del dispatch;
  `origenes_del_tablero()` = `ORIGENES_DEL_TABLERO`); `estadisticas_del_dia` y `generar_snapshot_operativo` la usan.
  `casos_abiertos` no cambió. "Por reasignar" se calcula de los casos abiertos y solo lo ve el dispatch.

### 11.2 El dispatch asigna, no cierra (fase 10) — ✅
- **D18.** Se quita el botón ✓ (cerrar) de las tarjetas del tablero. Cerrar es del técnico, en Mi seguimiento
  (y en el traspaso). El trigger rechaza que un dispatch cambie `estado` a `cerrado` (la UI no es la barrera).
- **D25 (P1 resuelto, 21/11). Cancelar = el caso deja de existir.** El ✓ del tablero se reemplaza por
  **Cancelar** (solo dispatch): borra el caso (y sus responsables, notificaciones e ítems de traspaso en borrador),
  así el código queda libre para volver a usarse. Es la **única excepción** a "los casos no se borran". RPC
  `cancelar_caso(caso_id, motivo)` (security definer, solo dispatch, motivo opcional) que antes copia los datos del
  caso a la bitácora (`caso_cancelado`) y avisa al técnico con una notificación `cancelado` que guarda el código en
  texto (`notificaciones.caso_id` pasa a admitir null). Confirmación anclada; si el técnico ya lo trabajó
  (descripción, estado o etiqueta), la confirmación lo advierte.
  **Supuesto:** solo se cancela desde el tablero, es decir, casos que el dispatch asignó **hoy**, y nunca uno que ya
  salió en un traspaso enviado (ese lo cierra el técnico). Un caso cerrado del tablero no se edita ni se cancela.
- **Técnico equivocado:** se corrige reasignando (arrastrar y soltar, ya existe). No es cancelar.
- **D26. Editar el caso es solo del dispatch:** acción **Editar** en la tarjeta para corregir **código** y
  **empresa**. El trigger abre `codigo` solo al dispatch (sigue normalizado y único: 23505 → "Ese código ya existe").
  Queda en la bitácora con el valor anterior.
- **D18b. Nuevo caso:** el segundo campo deja de ser "Comentario" y pasa a ser **Empresa** (opcional), que se guarda
  directo en `casos.cliente`. Aplica al formulario en la columna, al modal Nuevo caso y a `asignar_a_ronda(codigo,
  empresa)` (cambia la firma en la 11). La tarjeta del tablero muestra la empresa. `casos.nota` queda solo como
  histórico (se sigue mostrando si tiene texto).

### 11.3 Seguimiento: descripción y última actualización (fase 12) — ✅
- **D19. "Última actualización" es una fecha, no un texto.** Es el momento en que el técnico tocó el caso por última
  vez. La actualizan: cambiar área, empresa, estado, etiqueta o descripción, **o** el botón **"Actualizado"** (un
  clic: "lo revisé, sigue igual"). Unifica `actividad_tecnico_en` (D9): es la misma fecha y reinicia las alertas
  2/4/6 h. Se muestra relativa ("hace 35 min") con la hora exacta al pasar el mouse.
- **D20. Descripción única del caso.** Un solo cuadro de texto, **Descripción** (`casos.descripcion`), donde el técnico
  cuenta qué pasa. El técnico la edita en sus casos (hoy el trigger la bloquea). Guardado con Ctrl+Enter o al salir
  del cuadro; el botón Guardar solo se activa si hay cambios.
- Migración `sql/12_v2_seguimiento_descripcion.sql`: abrir `descripcion` al técnico; copiar el texto de
  `ultima_actualizacion` a `descripcion` cuando esta esté vacía (y a la bitácora); RPC `marcar_actualizado(caso_id)`
  (solo el responsable); `ultima_actualizacion_en/por` = cualquier edición del técnico. `ultima_actualizacion`
  (texto) deja de escribirse (no se borra la columna).

### 11.4 Seguimiento en tarjetas horizontales (fase 12) — ✅
- En días cargados hay más de 20 casos: cada caso pasa a ser **una fila** (ancho completo, ~56 px):
  `tipo · código (copiar) · empresa · área · estado · etiqueta · descripción (1 línea, clic para expandir) ·
  última actualización + botón Actualizado · menú (historial, copiar resumen)`.
- Grupos colapsables con contador (Recibidos en traspaso · Nuevos de hoy · De días anteriores) y barra de filtros fija.
- El borde de la fila toma el color del nivel de alerta (2/4/6 h sin actualizar) para que el técnico vea qué
  tiene olvidado antes que coordinación.
- Bajo 1100 px la fila se parte en dos líneas; en móvil, tarjeta.

### 11.5 La nota del traspaso **es** la descripción (fase 12) — ✅
- **D21.** El técnico trabaja su caso en Mi seguimiento y cierra turno traspasándolo con **el último estado de esa
  descripción**. En la pestaña Traspaso el campo "Nota para quien recibe" muestra la descripción del caso (editable);
  al enviar se guarda en el caso. Desaparece el cuadro "Última actualización" del traspaso.
- `enviar_traspaso` exige **descripción no vacía** (en lugar de última actualización) para entregar un caso.
  `traspaso_items` guarda la descripción enviada (foto para Mis traspasos); el reporte (Outlook/texto/TSV) muestra
  Descripción y "Últ. actualización: hora". Lo recibido en Mi seguimiento ya trae la descripción: deja de hacer
  falta la "nota de quien entregó" aparte (se sigue viendo en el historial del caso).
- Implementado: la descripción del traspaso es la del caso (se guarda en el caso al salir del campo) en vez de una
  copia editable aparte, así nunca hay dos versiones. `traspaso_items.descripcion` guarda la foto al enviar.
- **Verificación pedida (✅ con pruebas, falta en DEV):** al cerrar turno los casos deben aparecer en el **Mi seguimiento del receptor** (incluido
  el destino del día siguiente). Hoy la prueba de app solo revisa al que entrega y el backend simulado elige mal la
  fecha destino (`jornadas.find` por técnico, sin fecha). Se agrega: prueba de app con sesión del receptor,
  prueba SQL de `casos_abiertos` con RLS del receptor (mismo día y D+1) y revisión en DEV con dos usuarios.

### 11.6 Etiquetas con combobox y catálogo propio (fase 12) — ✅
- **D22.** La etiqueta se elige en un **combobox** (escribir filtra; flechas + Enter; muestra sugeridas y creadas)
  con la opción **"Crear «texto»"**. Se usa igual en Mi seguimiento, Traspaso y filtros.
- **Confirmado (21/11): etiquetas propias locales.** Su función es la del formato de `traspasos-noc`: un
  comentario corto que **acompaña a la descripción** (chip de color delante de la descripción en Outlook,
  `[ETIQUETA] descripción` en texto/TSV, y prioridad al ordenar el reporte). Las creadas por el técnico se guardan
  solo en **su navegador** (`localStorage`, envuelto en try/catch, máx. ~30, se pueden quitar); no hay tabla ni
  migración. La etiqueta elegida sí se guarda en el caso (`casos.etiqueta`) y viaja con él.
- Sugeridas fijas con su color (`ETIQUETAS_SUGERIDAS` en `domain/`): Crítico / VIP · Seguimiento · Pendiente
  cliente · Escalar · VM · Monitoreo. Las propias usan un color neutro.

### 11.7 Confirmaciones sin `window.confirm` (fase 11) — ✅
- **D23.** Ningún `window.confirm/alert/prompt` (hoy hay 6: cerrar caso, cerrar turno, reasignar/reabrir ×2,
  desactivar técnico, copiar semana). Se reemplazan por `scripts/ui/confirmar.ts`
  (`confirmar(opciones): Promise<boolean>`):
  - **Confirmación anclada** (popover junto al botón) para lo liviano: cerrar caso, desactivar técnico, reabrir.
  - **Panel de confirmación** (modal con resumen) para lo grave: **Cerrar turno** muestra cuántos casos van a cada
    receptor, cuáles se cierran y los recordatorios; Copiar semana muestra qué se reemplaza.
  - Botón peligroso en rojo, Esc cancela, Enter confirma, foco atrapado y devuelto, texto vía `textContent`.

### 11.8 Fechas rápidas (fase 11) — ✅
- **D24.** Los `<input type="date">` (recordatorio del traspaso, Mis traspasos, Historial, solicitud de
  planificación) pasan a un selector propio `scripts/ui/fecha.ts`:
  - **Chips de un clic:** Hoy · Mañana · Pasado mañana · próximos días de la semana (lun, mar…) según el contexto
    (el recordatorio solo ofrece fechas futuras).
  - **Escritura rápida** (no texto libre: se interpreta y se muestra la fecha resultante antes de aceptar):
    `+1`, `+3`, `lun`, `vie`, `25`, `25/11`, `h` (hoy), `m` (mañana). ↑/↓ suman o restan un día.
  - Mini calendario en popover para lo demás. Formato visible `sáb 21/11`, valor ISO.
  - El intérprete es puro: `domain/dateInput.ts`, con pruebas.
  - Implementado: no hay campos de fecha en Historial ni en la solicitud de planificación (usan listas),
    así que hoy se aplica al recordatorio del traspaso y a Mis traspasos. El `<input type="date">` original queda
    oculto con el valor ISO, así el resto del código no cambió.

### 11.9 Estilo visual (fase 11) — ✅
- Se adopta el lenguaje de `traspasos-noc` (referencia del usuario): tipografía **Inter** (empaquetada con
  `@fontsource-variable/inter`, sin CDN), paleta **navy** (`#081829 · #0F2942 · #163B5E · #1E4E79 · #E8F0F8 ·
  #F4F8FC`) sobre grises *slate*, botones primarios navy oscuros, radios de 12 px, sombras mínimas, chips en
  píldora, códigos en mono, campos de 36–40 px con borde suave y anillo de foco navy.
- Todo vía tokens en `abstracts/_variables.scss` (regla del proyecto): primero tokens, luego botones, campos,
  combos, pestañas y tarjetas. No se agrega Tailwind.

### 11.10 Dinamismo (fase 11) — ✅
- La capa propia (`ui/motion.ts`, FLIP del tablero) se mantiene.
- **D27 (P2 resuelto, 21/11): se usan ambas.** **`@formkit/auto-animate`** para altas/bajas/reordenamientos de
  listas (filas de seguimiento, resultados de filtros, notificaciones, ítems del traspaso) y **Motion** (`motion`,
  API vanilla `animate`/`stagger`) para paneles, popovers, confirmaciones y microinteracciones (botón Actualizado,
  chips). Solo se importan desde `scripts/ui/` (un envoltorio que apaga todo con `prefers-reduced-motion`); el FLIP
  del tablero sigue en `ui/motion.ts`.

### 11.11 Filtros y tipo de caso (fase 13) — ✅ `sql/13_v2_filtros.sql`
- **Tipo de caso** por prefijo del código (`domain/caseType.ts`, = función SQL `tipo_de_caso()` con prueba):
  `#SR…` o `#INC…` → **FRESH** · `SCTASK…` → **Tarea** · `INC…` → **Incidente** · otro → **Otro**. Se muestra como
  chip en tarjetas y filas.
- Filtros combinables: **técnico · área · estado · tipo** (+ el buscador de texto que ya existe), en Tablero,
  Mi seguimiento (sin técnico), Traspaso, Buscar casos y Panel. Un solo módulo de dominio (`caseFilters.ts`) y un
  componente de barra reutilizable; chips con contador y "Limpiar". Se recuerdan por vista en `sessionStorage`.
- Implementado: FRESH es solo `#SR…`/`#INC…` (otro `#` cuenta como Otro). En el Panel, con filtros las estadísticas
  se calculan en el navegador con el tablero del día (mismo criterio D17) para no consultar la base por cada
  combinación. En el Traspaso el filtro de técnico es el **receptor**. La migración 13 suma `area` y `tipo` a
  `tablero_del_dia`.

### 11.12 Bitácora solo para supervisión (fase 10) — ✅
- **D28.** La pestaña **Bitácora** la ven solo **dispatch y coordinación** (`[data-supervision-only]`). El técnico no
  la ve, y la BD lo impone: en la `11` la política de lectura de la bitácora pasa a `es_dispatch() or
  es_coordinador()`. **Supuesto:** el Historial (snapshots) sigue igual para todos.

### 11.13 Despliegue
- Cola de migraciones para DEV y luego PROD, en orden: **07 → … → 14 → 15** (al 22/11/2026 están aplicadas
  todas, hasta la 15, en ambas). Cada nueva es
  idempotente, con prueba en `tests/sql/` y en `MIGRACIONES`.

---

## 12. Requerimientos v2.3 (22/11/2026)

Revisión del usuario sobre DEV con datos de prueba (`docs/interno/DATOS_DE_PRUEBA.md`, local y sin versionar).

### 12.1 Turno C por tramos (fase 14) — ✅ `sql/14_v2_turno_c_variantes.sql`
- **D29.** El turno C se planifica por tramos: **C1 22:00–00:00** y **C2 00:00–06:00**. Quien hace toda la noche
  tiene los dos: se guarda como `turnoC` 22:00–06:00 y se muestra "C1 + C2". No hay un "C" sin tramo: la jornada C
  siempre lleva horario (`jornada_horario_valido`); las que había sin horario pasaron a C1 + C2.
- Disponibilidad, ronda, recordatorios y alertas de coordinación usan el horario del tramo (`inicio_de_turno`
  suma un día a las horas antes de las 06:00: C2 empieza a las 00:00 del día siguiente en el reloj).
- **Traspasos sin cambios (decisión del usuario):** todo tramo es "turno C": recibe de B/Comodín el mismo día y
  entrega a A/Comodín del día siguiente. C1 **no** entrega a C2.
- `HORARIOS_TURNO_C` (`domain/shifts.ts`) = `public.horarios_turno_c()`, con prueba de coincidencia.

### 12.2 Color de la tabla del traspaso — ✅
- **D30.** Seis paletas predefinidas (Cálido, Azul, Verde, Grafito, Morado, Vino) para el marco de la tabla que
  se copia a Outlook; los chips por turno y por etiqueta no cambian. Cada técnico elige la suya en la vista previa
  del Traspaso y queda en su navegador (`localStorage` `panel-noc:paleta-traspaso`); Mis traspasos usa la misma.

### 12.3 Pulido visual — ✅
- Tarjeta del tablero: código + tipo en la primera línea (el tipo baja si no cabe), empresa + estado en la
  segunda. Ya no se superponen los chips. Encabezado del ítem de traspaso con chip de tipo y candado "Fijar".
- Al soltar o reasignar un caso, la tarjeta se tiñe del color de acento y vuelve despacio a su color (1,6 s).

### 12.4 Quedarse un caso para mañana — ✅ `sql/15_v2_traspaso_propio.sql`
- **D31.** Al cerrar turno, el técnico puede entregarse un caso **a sí mismo para su turno de mañana**, si está
  planificado mañana en un turno que reciba del suyo según D6 (p. ej. comodín hoy y comodín mañana, o B hoy y A
  mañana). Para el mismo día, nunca. En la lista de receptores aparece como "Nombre (tú) · turno · mañana"; el
  reparto automático no lo usa (hay que elegirlo a mano o marcarse en la lista).
- El caso no cambia de dueño pero sí de día: se cierra el tramo de hoy en `caso_responsables` y se abre uno con
  origen `traspaso` y la fecha de mañana. En Mi seguimiento sale en "Recibido en traspaso · Para tu turno del dd/mm".
  No genera aviso (es suyo); la bitácora anota "Se queda con X para su turno del dd/mm".
- **Carga en 0 (D2) solo con lo de hoy:** lo que ya es para un turno futuro (propio o que otro le entregó para
  mañana) no impide cerrar el turno de hoy ni aparece en el traspaso de hoy; se entrega al cerrar ese turno.

---

## 13. Requerimientos v2.4 · seguridad y casos perdidos (23/11/2026)

> Origen: auditoría del 23/11/2026. El objetivo del sistema es que ningún caso se pierda entre turnos; el
> traspaso solo funciona si el técnico lo hace. Si se le olvida, antes nadie se enteraba: las alertas de
> coordinación se callaban al terminar su turno y "Por reasignar" solo miraba si el responsable trabaja hoy.

### 13.1 Lectura solo con perfil — ✅ `sql/16_v2_proteccion_de_casos.sql`
- **D32.** `casos`, `caso_responsables`, `jornadas`, `tecnicos` (y por tanto `casos_abiertos`, `tablero_del_dia` y
  Realtime) solo los lee quien tiene fila en `perfiles` (`tiene_perfil()`). Antes bastaba cualquier sesión de
  Supabase: con el registro abierto, cualquiera con la URL y la clave publicable (públicas en el JS) podía crearse
  una cuenta y leer todo. `tecnicos_de_la_ronda()` igual.
- Además (configuración, la hace el usuario): desactivar *Allow new users to sign up* en DEV y PROD
  (`docs/ENTORNOS_Y_DESPLIEGUE.md` §1 paso 9).

### 13.2 Turno terminado sin traspaso — ✅
- **D33.** Un caso queda "sin traspaso" si el turno en que su responsable lo tenía (su tramo vigente en
  `caso_responsables`) terminó hace más de `gracia_cierre_de_turno()` (**30 min**) y ese técnico no envió el
  traspaso de ese día **después** de recibir el caso (lo que llega tras enviar el traspaso también cuenta).
  `turno_sin_traspaso(tecnico, fecha, desde)` lo calcula; `casos_abiertos.sin_traspaso_desde` = fin de ese turno.
- Efectos: el caso entra en **"Por reasignar"** del dispatch aunque el técnico trabaje hoy ("Ana: terminó su turno
  (dd/mm hh:mm) sin traspasarlo", en rojo); en **Mi seguimiento** lleva el chip "Sin traspasar desde dd/mm hh:mm";
  coordinación recibe la alerta **`turno_sin_traspaso`** (crítica, va primero; una por caso y turno; se da por
  leída sola al traspasarse, reasignarse o cerrarse el caso). En Panel y campana, un caso con esta alerta no repite
  su "N h sin actualización" (`alertasActivas`); atenderla marca también esas.
- Las alertas 2/4/6 h (D12) no cambian: siguen contando solo dentro del turno.

### 13.3 Aviso previo — ✅
- **D34.** 30 min antes del fin de su turno, si no ha enviado el traspaso y tiene casos de hoy, el técnico recibe
  la notificación `cierre_pendiente` ("Traspaso pendiente: tu turno termina a las 14:00 y tienes N caso(s) por
  traspasar"), una por turno. Al tocarla abre la pestaña Traspaso.
- 13.2 y 13.3 los hace `vigilar_cierres_de_turno()` (pg_cron `cierres-de-turno`, cada 5 min).

### 13.4 Tiempo sin actualizar — ✅
- Filtro **"Sin actualizar"** (+2 h, +4 h, +6 h, +1 día, "Quedó sin traspaso") en Mi seguimiento y Buscar casos
  (`caseFilters.ts`, campo `atraso`). Cuenta desde la **última actualización** (la misma del "hace N" de la fila; si
  nunca se actualizó, desde la llegada), sin reiniciarse por turno (`horasDesdeLaActualizacion`); los cerrados no
  cuentan. El borde de atraso sí toma lo más reciente entre actualización y llegada (`horasSinActualizar`), para que
  un caso recién recibido no salga en rojo.
- Mi seguimiento: **Ordenar** "Por asignación" / "Más tiempo sin actualizar" (lo sin traspaso primero).

### 13.5 Endurecimiento del cliente — ✅
- **D35.** CSP por `<meta>` en `Layout.astro` (solo en compilación de producción; `astro dev` inyecta scripts en
  línea): `script-src 'self'`, `connect-src` solo el Supabase configurado (https + wss), `object-src 'none'`,
  `base-uri`/`form-action 'self'`. `style-src` necesita `'unsafe-inline'` por los `style=""` del reporte del
  traspaso. Font Awesome del CDN con `integrity` (SRI). GitHub Pages no permite cabeceras: `frame-ancestors`
  (clickjacking) no se puede fijar desde `<meta>`.
- Verificado con `astro preview` (variables de prueba): login funciona, sin violaciones de CSP, íconos cargan.

---

## 14. Requerimientos v2.5 · traspaso y colores (23/11/2026)

### 14.1 Etiquetas que dicen en manos de quién está el caso — ✅
- **D36.** Sugeridas: **Crítico / VIP · Esperando cliente · Esperando proveedor · Escalado N2 · Ventana programada ·
  Validar con usuario · Requiere visita** (el orden es la prioridad del reporte). Las anteriores ya guardadas en
  casos conservan un color parecido (Crítico → crítico, Escalar → escalado, VM → ventana, Pendiente cliente →
  cliente; Monitoreo y Seguimiento → neutro). Las propias de cada técnico no cambian.
- El reporte del traspaso colorea por **color de etiqueta** (`colorDeEtiqueta`), no por texto exacto.

### 14.2 Estado y área con color — ✅
- Como las etiquetas: `$colores-estado` (En curso azul · Pausado ámbar · Resuelto verde · Cerrado gris) y
  `$colores-area` (uno por área, `claveDeArea`: "CORE IP" → `core-ip`). `scripts/ui/colorDeCaso.ts` pinta chips y
  listas (`colorearLista` repinta al cambiar). Dónde: Mi seguimiento (listas de estado y área), Traspaso (lista de
  estado y chip de área), tarjeta del tablero (chip de estado) y Buscar casos (estado, área y etiqueta). Una prueba
  verifica que cada área, estado y color de etiqueta tenga su par en los estilos.

### 14.3 Recordatorio opcional en el traspaso — ✅
- Casilla **"Agregar recordatorio"** que muestra fecha y texto. Marcada sola si el caso ya trae recordatorio;
  desmarcarla borra fecha y texto.

### 14.4 Receptor por turno, con búsqueda; todos entran al reparto — ✅
- Cada caso: lista **Turno** ("Todos los turnos (N)" + "Turno C1 + C2 · hoy (2)"…, `gruposDeReceptores`) y
  **Entregar a**, acotada al turno elegido (si el caso ya tiene receptor, arranca en su turno). "Entregar a" tiene
  **búsqueda rápida** (`ui/listaConBusqueda.ts`: combobox sobre el `<select>`, que queda oculto con el valor; acepta
  el texto exacto o una coincidencia única: "marta" → Marta Soto).
- Los receptores se muestran plegados: "Reparto entre todos (N)" · *Excluir a alguien*. Todos entran por defecto;
  el técnico desmarca a quien quiera dejar fuera (uno mismo sigue fuera por defecto, D31).

### 14.5 Historial en Buscar casos — ✅
- Mi seguimiento ya no despliega el historial en la fila (con casos de 5–6 días ocupaba mucho): el botón abre el caso
  en **Buscar casos**, que ahora también tiene el técnico. Ve responsables y los traspasos que entregó o recibió
  (RLS de `traspasos`; supervisión ve todos).

---

## 15. Requerimientos v2.6 · reparto por supervisión (23/11/2026)

### 15.1 Repartir lo que quedó sin dueño — ✅ `sql/17_v2_entrega_por_supervision.sql`
- **D37.** Si un técnico se fue sin traspasar (o no trabaja hoy), avisar no basta: el **dispatch o coordinación**
  reparte sus casos con **«Repartir…»** en la franja "Por reasignar" (coordinación ahora también la ve, sin
  arrastre). El modal tiene tres decisiones: **casos** (todos marcados), **turno que los recibe** (los de hoy que no
  han terminado y los de mañana, `receptoresParaEntregar` + `turnoTerminado`) y **entre quiénes** (todos los de ese
  turno marcados). El reparto es parejo y alterna tipos (`repartirEntrega` = `repartirCasos` del traspaso) y se ve
  antes de entregar ("Luis Mora (2): INC21, SCTASK22").
- `entregar_casos(p_entregas)` (dispatch o coordinación; todo o nada): el caso pasa al **seguimiento** de quien
  recibe como traspaso (origen `traspaso`, fecha de su jornada: hoy o mañana), no al tablero del día. Valida que el
  receptor esté activo, planificado ese día y con el turno sin terminar. Notificación `traspaso` al receptor y
  bitácora `entregado_por_supervision`. Puede dejarle el caso al mismo técnico para su turno de mañana (nuevo tramo).
  La alerta `turno_sin_traspaso` se da por leída sola (cambia el responsable). Interna `entregar_casos_en(…, ahora)`
  solo para pruebas.
- El arrastre del dispatch a una columna sigue igual (reasignación al tablero de hoy).

### 15.2 El turno limita "Entregar a" — ✅
- En el Traspaso, al elegir un turno la lista queda **solo** con ese turno: si quien estaba elegido es de otro turno,
  se quita (el caso vuelve a "elige a quién se entrega"); si el turno tiene una sola persona, queda elegida. Si el
  reparto automático mueve el caso a otro turno, la lista sigue al receptor.

### 15.3 Buscadores que vuelven al estado normal — ✅
- Buscar casos: al vaciar el campo (borrar, Esc o la ✕ del navegador) se quitan los resultados y el mensaje.
- Búsqueda de "Entregar a": vaciar el texto ya no quita a quien estaba elegido; al salir del campo vuelve a mostrarse.

