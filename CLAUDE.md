# Panel NOC · Traspasos y Turnos — contexto rápido

Panel web en tiempo real para un NOC: casos (INC/SCTASK…) asignados a técnicos según su turno **del día**,
planificación semanal, almuerzos, búsqueda, historial diario (snapshots) y bitácora de cambios.
Roles: **dispatch** (edita todo) y **técnico** (hoy: tablero en solo lectura). Todo el código, nombres y
mensajes están **en español**; mantén ese idioma.

> **En curso: v2.** Rama de trabajo **`desarrollo`**, nunca `main`. Diseño, modelo, fases y estado en
> `docs/DISENO_V2.md`: léelo antes de tocar BD, tablero o módulos nuevos. Fases 1 (BD), 2 (dispatch + corte)
> y 3 (login + recuperar contraseña) hechas; siguen técnico (4), traspasos (5), búsqueda global (6), animaciones (7).
> Referencia para traspasos/exportación: `C:\Users\Eme\Downloads\traspasos-noc` (JS sobre Excel; se portan
> `report.js`, `sorting.js`, `balancer.js`, no los parsers).

**Stack:** Astro 7 (sitio estático, sin SSR) · TypeScript estricto · SCSS · Supabase (Auth, Postgres, RLS,
Realtime, pg_cron) · Bun · Vitest (+ jsdom, + PGlite para SQL). Deploy: GitHub Pages (rama `gh-pages`).

## Comandos

```bash
bun run dev         # local, usa .env.development (base Supabase DEV)
bun run check       # tipos (astro check)
bun run test:unit   # solo tests/domain, rápido, sin build
bun run test        # build + todas las pruebas (igual que el CI)
```

## Arquitectura (cada capa solo conoce la de abajo)

```
pages/ + components/   Marcado Astro sin lógica. Lo dinámico son <template> que scripts/ clona.
        │
scripts/               Comportamiento en el navegador
  main.ts              Arranque: sesión → perfil/rol → iniciar módulos → store.subscribe(render) → sync
  auth/                /login/ (entrar + recuperar), /restablecer/ (contraseña nueva), authUi (campos, carga)
  board/               Vistas del tablero (+ franja "por reasignar"), eventos, drag & drop, renderScheduler
  planning/            Planificación semanal (grilla técnico × día), solo dispatch
  modals/              Un controlador por modal + assignFlow (reglas de asignación compartidas)
  features/            Pestañas (según rol), buscador, filtro por técnico, sesión, estado de conexión
  history/ audit/      Vistas de Historial y Bitácora
  actions/             Casos de uso: service → recarga (cargarDatos) → aviso/sonido
  ui/                  toast, sonido, portapapeles, tablas, formato
        │
state/                 appStore (createStore: get/set/subscribe) + sync.ts (Realtime + respaldo)
        │
services/              ÚNICO lugar que habla con Supabase. Repos devuelven Resultado<T>, nunca lanzan.
                       perfilRepo, tecnicosRepo (catálogo), jornadasRepo, casosRepo, historial, bitácora
        │
domain/                Reglas puras (sin DOM ni Supabase): día operativo y semanas (time), turnos, disponibilidad,
                       almuerzo, planificación, traspasos (handover), métricas, búsqueda, asignaciones
types/                 noc.ts (modelo) y result.ts (Resultado, exito, falla)
styles/                SCSS por parcial; colores/tema SOLO en abstracts/_variables.scss
```

### Flujo de datos

1. Acción del usuario → `scripts/actions/*` → `services/*Repo` (Supabase) → `Resultado`.
2. Si ok → `cargarDatos()` relee catálogo + jornadas de la fecha operativa + `casos_abiertos` → `appStore.set()`.
   `tecnicosDelDia()` arma `Tecnico` (catálogo + jornada: turno, horario, almuerzo) y `casosDelTablero()` filtra.
3. El store notifica → `solicitarRender()` redibuja tablero y métricas (se pospone si hay drag o
   escritura en un formulario de tarjeta).
4. Otros clientes: Realtime (tecnicos, jornadas, casos, caso_responsables) solo avisa "hubo cambios" →
   `solicitarSincronizacion()` (debounce 150 ms). Respaldo: relectura cada 60 s, al volver a la pestaña y al recuperar red.
5. Cada 30 s se re-renderiza por la hora; si cambió la fecha operativa (06:00) se vuelve a leer todo.

## Reglas del proyecto (respetar siempre)

- `domain/` no importa Supabase ni DOM: debe poder probarse aislado.
- Solo `services/` importa `supabaseClient`. Errores → `errorDeBaseDeDatos()` → `falla(...)` con mensaje en español.
- `.astro` = solo marcado; la lógica en `scripts/`, un archivo por responsabilidad.
- Texto de usuario (código, nota, nombre) siempre vía `textContent`. **Nunca `innerHTML` con datos.**
- Mapeo snake_case (BD) ↔ camelCase (TS) se hace en cada repo (`aIncidente`, `aJornada`, etc.).
- Los permisos los impone la BD (RLS + triggers); la UI solo oculta (`body.solo-lectura`, `[data-edit-only]`).
- Casos y técnicos **no se borran**: los casos se cierran, los técnicos se desactivan.
- Reglas duplicadas a propósito en SQL y TS, con prueba que verifica que coincidan:
  `desfase_traspaso()` = `domain/handover.ts`; horarios de comodín (`jornada_horario_comodin`) = `HORARIOS_COMODIN`.

## Dominio clave

- **Día operativo** 06:00 → 06:00 (Honduras): `fechaOperativa()` / `public.fecha_operativa()`. A las 06:00 el
  tablero queda limpio sin borrar nada; los casos abiertos de un responsable que no trabaja hoy salen en
  "Por reasignar".
- Turnos: A 06–14, B 14–22, C 22–06. **Comodín**: 06–16, 07–17 u 08–18; aparece en los turnos que toca.
  El turno es **por día** (tabla `jornadas`), lo planifica el dispatch por semana; el almuerzo también.
- Un técnico recibe casos solo si está `disponible` (en horario y fuera de almuerzo) → `domain/availability.ts`.
- Un código de caso existe una sola vez en todo el historial. Asignar uno cerrado ofrece reabrirlo.
- Estados: En curso · Pausado · Resuelto · Cerrado. Al cerrar turno todo lo no cerrado se traspasa (fase 5).

## Base de datos (`sql/`, se ejecutan a mano en el SQL Editor de Supabase)

- `01_schema_inicial.sql`, `02_migracion_v3.sql`: modelo anterior (histórico; la 05 lo retira).
- `04_v2_modelo_base.sql` (aditiva): día operativo, `perfiles` + roles (`es_dispatch()`, `mi_tecnico_id()`),
  `jornadas`, `casos` + `caso_responsables` (historial, lo escriben triggers), `notificaciones`, `traspasos` +
  `enviar_traspaso()`, `generar_snapshot_operativo()`.
- `05_v2_corte.sql`: resincroniza lo hecho con la app anterior, **borra** `incidentes` y el turno fijo de
  `tecnicos`, RLS de técnicos solo dispatch, vista `casos_abiertos` (security_invoker), cron 05:59.
  Rompe la app anterior: se ejecuta justo antes de publicar la v2 (ver `docs/DISENO_V2.md` §9).
- `03_datos_demo_dev.sql`: solo DEV (requiere `public.entorno_dev`); no toca `perfiles`.
- Roles: solo por SQL (`insert into perfiles ...`, ejemplo en la cabecera de la 04).
- Cambios de esquema → nuevo archivo `sql/0N_*.sql` idempotente + actualizar `tests/sql/`.

## Entornos

- `PUBLIC_APP_ENV` debe ser `development` en `astro dev` y `production` en `astro build`;
  `services/environment.ts` aborta si no coincide. DEV muestra insignia y título `[DEV]`.
- Variables: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (solo la clave publicable, nunca service_role).
- Rutas siempre vía `RUTAS` (`scripts/routes.ts`), que respeta `BASE_PATH` de GitHub Pages; navegar con `irA()`
  (las pruebas lo sustituyen). `/restablecer/` debe estar en las *Redirect URLs* de Supabase de cada entorno.
- CI: `ci.yml` (ramas/PR, solo verifica) y `deploy.yml` (push a `main` → verifica, compila, publica `gh-pages`).
  Detalle en `docs/ENTORNOS_Y_DESPLIEGUE.md`.

## Pruebas (`tests/`, ninguna toca una base real)

- `domain/`: funciones puras.
- `app/`: la app real con jsdom (`// @vitest-environment jsdom`) contra `helpers/backendSimulado.ts`
  (stub de `fetch` que imita PostgREST: casos, jornadas con upsert, vista casos_abiertos). Usa
  `helpers/app.ts` (`iniciarApp(datos, { rol })`, `fijarHora` — lunes 9/11/2026, `esperar`).
- `sql/`: ejecuta los `.sql` en PGlite con un Supabase mínimo simulado (`helpers/baseSql.ts`: roles, auth,
  `actuarComo(uid)` para probar RLS; sin los bloques pg_cron).
