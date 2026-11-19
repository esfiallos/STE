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

### 5.1 Login
- "¿Olvidaste tu contraseña?" → `supabase.auth.resetPasswordForEmail(correo, { redirectTo: <base>/restablecer/ })`.
- `/restablecer/` → `supabase.auth.updateUser({ password })`.
- Requiere en Supabase (DEV y PROD): *Authentication → URL Configuration → Redirect URLs* con esa ruta.
- Mejoras visuales: estados de carga, errores en línea, transición de entrada.

### 5.2 Técnico
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
| **3. Login** | Recuperar/restablecer contraseña, pulido visual | — (paralelo) |
| **4. Técnico** | Mi día, Seguimiento, última actualización, notificaciones + alertas | 1, 2 |
| **5. Traspasos** | Armado, balanceo, etiquetas, export Outlook/TSV, envío transaccional | 4 |
| **6. Búsqueda global** | Casos + historial de responsables | 1 |
| **7. Animaciones** | Capa de efectos y pulido | 2, 4 |

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
1. `05_v2_corte.sql` en la base (la 04 ya debe estar aplicada).
2. Crear los perfiles: el tuyo como `dispatch` y los técnicos con su `tecnico_id`. Sin perfil, el usuario no
   entra al panel.
3. DEV: opcionalmente `03_datos_demo_dev.sql` y probar con `bun run dev`.
4. PROD: hacer 1 y 2 **justo antes** de unir `desarrollo` → `main` (el despliegue tarda unos minutos y en ese
   intervalo la app publicada anterior deja de funcionar, porque ya no existe `incidentes`).
5. Revisar en Planificación la semana en curso: la 05 solo crea la jornada de **hoy** a partir del turno fijo.
