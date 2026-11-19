# Panel NOC · Traspasos y Turnos — contexto rápido

Panel web en tiempo real para un NOC: casos (INC/SCTASK…) asignados a técnicos según su turno **del día**,
planificación semanal, almuerzos, seguimiento del técnico con notificaciones, historial diario (snapshots) y
bitácora. Roles: **dispatch** (asigna y planifica) y **técnico** (tablero en solo lectura + su seguimiento).
Todo el código, nombres y mensajes están **en español**; mantén ese idioma.

**Stack:** Astro 7 (sitio estático, sin SSR) · TypeScript estricto · SCSS · Supabase (Auth, Postgres, RLS,
Realtime, pg_cron) · Bun · Vitest (+ jsdom, + PGlite para SQL). Deploy: GitHub Pages (rama `gh-pages`).

---

## ▶ Cómo retomar en un contexto nuevo (leer primero)

1. Rama de trabajo: **`desarrollo`** (nunca `main`; `main` publica a producción). `git log --oneline -8`.
2. Lee este archivo completo y luego `docs/DISENO_V2.md` (§2 día operativo, §3 modelo, §5 módulos, §7 fases,
   §8 decisiones D1–D7, §9 despliegue). Las decisiones de §8 ya las tomó el usuario: no las re-preguntes.
3. `bun run test` debe dar todo verde antes de tocar nada (hoy: 17 archivos, 123 pruebas).
4. Siguiente trabajo: **Fase 5 — Traspasos** (detalle abajo en "Lo que falta").
5. Al terminar cada fase: pruebas (dominio + app + SQL si hay migración), `bun run check`, `bun run test`,
   actualizar **este archivo** (sección Estado) y `docs/DISENO_V2.md` (tabla §7). El usuario hace el commit.
6. Hay un conector de Supabase disponible con los proyectos del usuario: úsalo solo para **leer** y solo si el
   usuario lo pide; nunca ejecutes migraciones ni escrituras en PROD sin su confirmación explícita.

## Estado (al 19/11/2026)

| Fase | Estado | Qué quedó |
|---|---|---|
| 1. BD v2 | ✅ | `sql/04_v2_modelo_base.sql` (aditiva) |
| 2. Dispatch v2 + corte | ✅ | `sql/05_v2_corte.sql`, planificación semanal, tablero por día operativo, "Por reasignar", filtro por técnico, roles |
| 3. Login | ✅ | Recuperar contraseña (panel en `/login/`), página `/restablecer/`, mejoras visuales |
| 4. Técnico | ✅ | `sql/06_v2_seguimiento.sql`, pestaña **Mi seguimiento**, campana de notificaciones + alertas, su columna resaltada |
| 5. Traspasos | ⏳ siguiente | BD lista desde la fase 1; falta toda la UI |
| 6. Búsqueda global | ⏳ | Falta función SQL + pestaña |
| 7. Animaciones | 🟡 parcial | Login, seguimiento y campana ya animan; falta el tablero (mover/asignar) |

**Bases de datos (lo que el usuario ejecutó, según dijo):** PROD tiene la **04** aplicada (aditiva; la app
publicada sigue funcionando). La 05 y la 06 **no** deben correrse en PROD hasta el despliegue (ver §9 del diseño).
DEV: confirmar con el usuario si ya corrió 05 y 06 y si creó perfiles.

**Configuración pendiente (la hace el usuario):** en Supabase DEV y PROD agregar `/restablecer/` a
*Authentication → URL Configuration → Redirect URLs* y configurar SMTP propio (el correo incluido solo envía al
equipo del proyecto). Detalle: `docs/ENTORNOS_Y_DESPLIEGUE.md` §1 pasos 7–8.

**No verificado en navegador contra Supabase real:** fases 2 y 4 (solo pruebas con backend simulado). El login y
`/restablecer/` sí se revisaron visualmente en `bun run dev` (sin enviar nada).

## Lo que falta

### Fase 5 — Traspasos (siguiente)
Ya existe en BD (`04`): `traspasos` (borrador/enviado, uno por técnico y día), `traspaso_items` (receptor, estado,
etiqueta, nota_personalizada, ultima_actualizacion) y la RPC **`enviar_traspaso(id)`**, que valida y aplica todo en
una transacción: carga propia en 0 (todo lo no cerrado incluido), receptor planificado en un turno permitido,
última actualización obligatoria; los ítems "cerrado" se cierran; notifica a los receptores. Probado en
`tests/sql/modelo-v2.test.ts`. Reglas de destino en `domain/handover.ts` (`DESTINOS_DE_TRASPASO`,
`puedeRecibirTraspaso`). Falta construir:
- `services/traspasosRepo.ts`: crear/leer borrador del día, upsert de ítems, `rpc('enviar_traspaso')`.
- Pool de receptores: jornadas de hoy y de mañana (`listarJornadas(D, D+1)`) filtradas con `puedeRecibirTraspaso`
  según el turno de quien entrega. Si no hay nadie planificado: aviso y no dejar cerrar turno.
- Portar de `C:\Users\Eme\Downloads\traspasos-noc`: `services/balancer.js` (reparto con candados + deshacer),
  `services/report.js` (tabla HTML para Outlook con estilos en línea + TSV), `services/sorting.js`. Van a
  `domain/` en TS (son puros) con sus pruebas (`tests/*.test.js` de ese proyecto sirven de base). Los parsers de
  Excel **no** se portan: los casos salen de la BD.
- Vista (pestaña del técnico, p. ej. "Traspaso" o dentro de Mi seguimiento): tabla de mis casos no cerrados
  con receptor, estado, etiqueta, nota personalizada y última actualización; balancear; vista previa; copiar
  texto enriquecido (Outlook), texto plano y TSV (Excel); botón **Cerrar turno = enviar** deshabilitado mientras
  falte algo (la BD vuelve a validar).
- Al armar el borrador **precargar** estado, etiqueta y última actualización actuales de cada caso
  (`enviar_traspaso` escribe los valores del ítem en el caso; un ítem vacío borraría la etiqueta).
- En Mi seguimiento, los casos "Recibidos en traspaso" deberían mostrar la `nota_personalizada` de quien entregó
  (RLS ya permite al receptor leer esos ítems).

### Fase 6 — Búsqueda global
Función SQL nueva (p. ej. `buscar_casos(termino)`) sobre `casos` + `caso_responsables` (todos los casos alguna vez
creados, estado, responsable actual e historial) y una pestaña para ambos roles. Hoy existen
`buscar_en_historial()` (snapshots) y `buscar_en_bitacora()`.

### Fase 7 — Animaciones
Tablero: entrada/destello al asignar o mover un caso (FLIP), "pop" del contador de la tarjeta, realce de la
columna destino. Hacerlo en `scripts/ui/motion.ts` + SCSS; `_base.scss` ya apaga animaciones con
`prefers-reduced-motion`.

### Otros pendientes conocidos
- `03_datos_demo_dev.sql` no crea perfiles: para probar el rol técnico, enlazar un perfil a un técnico demo
  (`insert into perfiles (id, nombre, rol, tecnico_id) ...`).
- Las alertas de escritorio solo salen si el técnico las activa y la pestaña no está a la vista.

---

## Comandos

```bash
bun run dev         # local, usa .env.development (base Supabase DEV); http://localhost:4321
bun run check       # tipos (astro check)
bun run test:unit   # solo tests/domain, rápido, sin build
bun run test        # build + todas las pruebas (igual que el CI)
```
`.claude/launch.json` tiene `panel-dev` para levantar el servidor desde el panel de vista previa.

## Arquitectura (cada capa solo conoce la de abajo)

```
pages/ + components/   Marcado Astro sin lógica. Lo dinámico son <template> que scripts/ clona.
  index.astro          Tablero · Mi seguimiento · Planificación · Historial · Bitácora (según rol)
  login.astro          Entrar + recuperar contraseña   ·   restablecer.astro: contraseña nueva
        │
scripts/               Comportamiento en el navegador
  main.ts              Arranque: sesión → perfil/rol → iniciar módulos → store.subscribe(render) → sync
  auth/                loginPage, resetPage, authUi (mostrar contraseña, Bloq Mayús, carga, sacudida)
  board/               Vistas del tablero (+ franja "por reasignar"), eventos, drag & drop, renderScheduler
  planning/            Planificación semanal (grilla técnico × día), solo dispatch
  followUp/            Mi seguimiento del técnico (estado, etiqueta, última actualización, historial)
  notifications/       Campana del técnico: lista, no leídas, tiempo real, alertas de escritorio
  modals/              Un controlador por modal + assignFlow (reglas de asignación compartidas)
  features/            Pestañas (según rol), buscador, filtro por técnico, sesión, estado de conexión
  history/ audit/      Vistas de Historial y Bitácora
  actions/             Casos de uso: service → recarga (cargarDatos) → aviso/sonido
  ui/                  toast, sonido, portapapeles, tablas, formato
        │
state/                 appStore (createStore: get/set/subscribe) + sync.ts (Realtime + respaldo)
        │
services/              ÚNICO lugar que habla con Supabase. Repos devuelven Resultado<T>, nunca lanzan.
                       authService, perfilRepo, tecnicosRepo (catálogo), jornadasRepo, casosRepo,
                       notificacionesRepo, historialRepo, bitacoraRepo, realtime
        │
domain/                Reglas puras (sin DOM ni Supabase): time (día operativo, semanas), shifts, availability,
                       lunch, planning, handover (traspasos), followUp (seguimiento/notificaciones), credentials,
                       metrics, search, assignments, audit
types/                 noc.ts (modelo) y result.ts (Resultado, exito, falla)
styles/                SCSS por parcial; colores/tema SOLO en abstracts/_variables.scss
```

### Flujo de datos

1. Acción del usuario → `scripts/actions/*` → `services/*Repo` (Supabase) → `Resultado`.
2. Si ok → `cargarDatos()` relee catálogo + jornadas de la fecha operativa + `casos_abiertos` → `appStore.set()`:
   `tecnicos` (catálogo + jornada, vía `tecnicosDelDia()`), `incidentes` (tablero de hoy, `casosDelTablero()`) y
   `casosAbiertos` (todos, base de Mi seguimiento: incluye lo recibido para el próximo turno).
3. El store notifica → `solicitarRender()` redibuja tablero y métricas; Mi seguimiento y la campana también se
   suscriben. Ambos posponen el redibujo mientras se escribe o se arrastra.
4. Otros clientes: Realtime (tecnicos, jornadas, casos, caso_responsables) solo avisa "hubo cambios" →
   `solicitarSincronizacion()` (debounce 150 ms). Respaldo: relectura cada 60 s, al volver a la pestaña y al
   recuperar red. Las notificaciones llegan por su propio canal (`suscribirNotificaciones`, filtro por técnico).
5. Cada 30 s se re-renderiza por la hora; si cambió la fecha operativa (06:00) se vuelve a leer todo.

## Reglas del proyecto (respetar siempre)

- `domain/` no importa Supabase ni DOM: debe poder probarse aislado.
- Solo `services/` importa `supabaseClient`. Errores → `errorDeBaseDeDatos()` → `falla(...)` con mensaje en español.
- `.astro` = solo marcado; la lógica en `scripts/`, un archivo por responsabilidad.
- Texto de usuario (código, nota, nombre) siempre vía `textContent`. **Nunca `innerHTML` con datos.**
- Mapeo snake_case (BD) ↔ camelCase (TS) se hace en cada repo (`aIncidente`, `aJornada`, `aNotificacion`…).
- Los permisos los impone la BD (RLS + triggers); la UI solo oculta: `body.solo-lectura` + `[data-edit-only]`
  (sin rol dispatch) y `body.rol-tecnico` + `[data-tecnico-only]` (solo técnicos enlazados).
- Casos y técnicos **no se borran**: los casos se cierran, los técnicos se desactivan.
- Reglas duplicadas a propósito en SQL y TS, con prueba que verifica que coincidan:
  `desfase_traspaso()` = `domain/handover.ts`; horarios de comodín (`jornada_horario_comodin`) = `HORARIOS_COMODIN`.
- Navegar con `irA()` (`scripts/routes.ts`), no con `window.location.replace` directo (las pruebas lo sustituyen).

## Dominio clave

- **Día operativo** 06:00 → 06:00 (Honduras): `fechaOperativa()` / `public.fecha_operativa()`. A las 06:00 el
  tablero queda limpio sin borrar nada; los casos abiertos de un responsable que no trabaja hoy salen en
  "Por reasignar".
- Turnos: A 06–14, B 14–22, C 22–06. **Comodín**: 06–16, 07–17 u 08–18; aparece en los turnos que toca.
  El turno es **por día** (tabla `jornadas`), lo planifica el dispatch por semana; el almuerzo también.
- Destinos de traspaso: A → B/Comodín (mismo día) · B y Comodín → C (mismo día) o A/Comodín (día siguiente) ·
  C → A/Comodín (día siguiente).
- Un técnico recibe casos solo si está `disponible` (en horario y fuera de almuerzo) → `domain/availability.ts`.
- Un código de caso existe una sola vez en todo el historial. Asignar uno cerrado ofrece reabrirlo.
- Estados: En curso · Pausado · Resuelto · Cerrado. Al cerrar turno todo lo no cerrado se traspasa (fase 5).
- El técnico solo puede cambiar estado, etiqueta, nota y última actualización de **sus** casos (trigger
  `casos_antes_de_guardar` + RLS); la BD registra quién y cuándo escribió la última actualización.

## Base de datos (`sql/`, se ejecutan a mano en el SQL Editor de Supabase, en orden)

- `01_schema_inicial.sql`, `02_migracion_v3.sql`: modelo anterior (histórico; la 05 lo retira).
- `04_v2_modelo_base.sql` (aditiva): día operativo, `perfiles` + roles (`es_dispatch()`, `mi_tecnico_id()`),
  `jornadas`, `casos` + `caso_responsables` (historial, lo escriben triggers), `notificaciones` (las crea un
  trigger al asignar/traspasar), `traspasos` + `traspaso_items` + `enviar_traspaso()`, `generar_snapshot_operativo()`.
- `05_v2_corte.sql`: resincroniza lo hecho con la app anterior, **borra** `incidentes` y el turno fijo de
  `tecnicos`, RLS de técnicos solo dispatch, vista `casos_abiertos` (security_invoker), cron 05:59.
  Rompe la app anterior: se ejecuta justo antes de publicar la v2 (ver `docs/DISENO_V2.md` §9).
- `06_v2_seguimiento.sql`: `casos_abiertos` suma `origen_responsable` y `ultima_actualizacion_por`.
- `03_datos_demo_dev.sql`: solo DEV (requiere `public.entorno_dev`); no toca `perfiles`.
- Roles: solo por SQL (`insert into perfiles ...`, ejemplo en la cabecera de la 04). Técnico = `rol 'tecnico'`
  **con** `tecnico_id`; sin él no tiene seguimiento ni notificaciones.
- Cambios de esquema → nuevo archivo `sql/0N_*.sql` idempotente + prueba en `tests/sql/` + agregarlo a
  `MIGRACIONES` en `tests/helpers/baseSql.ts`. Una vista solo admite columnas nuevas **al final**.

## Entornos

- `PUBLIC_APP_ENV` debe ser `development` en `astro dev` y `production` en `astro build`;
  `services/environment.ts` aborta si no coincide. DEV muestra insignia y título `[DEV]`.
- Variables: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (solo la clave publicable, nunca service_role).
  `.env*` está bloqueado para lectura (`.claude/settings.json`).
- Rutas siempre vía `RUTAS` (`scripts/routes.ts`), que respeta `BASE_PATH` de GitHub Pages.
- CI: `ci.yml` (ramas/PR, solo verifica) y `deploy.yml` (push a `main` → verifica, compila, comprueba que existan
  `/`, `/login/` y `/restablecer/`, publica `gh-pages`). Detalle en `docs/ENTORNOS_Y_DESPLIEGUE.md`.

## Pruebas (`tests/`, ninguna toca una base real)

- `domain/`: funciones puras.
- `app/`: la app real con jsdom (`// @vitest-environment jsdom`) contra `helpers/backendSimulado.ts`
  (stub de `fetch` que imita PostgREST: casos con `_fecha`/`_origen`, jornadas con upsert, vista casos_abiertos,
  notificaciones, caso_responsables). `helpers/app.ts`: `iniciarApp(datos, { rol, tecnicoId })`, `fijarHora`
  (lunes 9/11/2026), `esperar`. Páginas de acceso: `tests/app/acceso.test.ts` (simula `authService` e `irA`).
- `sql/`: ejecuta los `.sql` en PGlite con un Supabase mínimo simulado (`helpers/baseSql.ts`: roles, auth,
  `actuarComo(uid)` para probar RLS; sin los bloques pg_cron).
- Usan `dist/` compilado: `bun run test` compila primero; si corres vitest suelto, haz `bun run build` antes.
