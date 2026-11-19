# Panel NOC · Traspasos y Turnos

Panel en tiempo real para sistemas de asignación de tickets: casos asignados a técnicos según su turno del día
(A mañana, B tarde, C nocturno y comodín), planificación semanal, almuerzos, búsqueda con copia rápida,
roles dispatch / técnico, historial diario y bitácora de cambios por usuario.

**Stack:** Astro · SCSS · Supabase (Auth, Postgres, RLS, Realtime, pg_cron) · Bun · TypeScript.

Diseño de la v2 (roles, traspasos, notificaciones) y su avance: [`docs/DISENO_V2.md`](docs/DISENO_V2.md).

## Cómo funciona

- **Roles:** el *dispatch* asigna y planifica; el *técnico* ve el tablero en solo lectura. El rol se asigna por SQL
  (tabla `perfiles`) y lo hace cumplir la base de datos.
- **Día operativo:** va de 06:00 a 06:00 (hora de Honduras). A las 06:00 el tablero empieza limpio sin borrar nada;
  los casos abiertos cuyo responsable no trabaja hoy aparecen en **Por reasignar**.
- **Planificación:** el turno no es fijo: el dispatch arma la semana (técnico × día) y cada mañana revisa el día.
  Los horarios de los turnos y del comodín están en `src/domain/shifts.ts`.
- **Tablero:** turnos → técnicos → casos, en tiempo real, con filtro por técnico.
- **Disponibilidad:** un técnico recibe casos solo si está en su horario y fuera de su almuerzo. Si no, su columna se
  atenúa (amarillo en almuerzo, gris fuera de horario), el botón «+» se deshabilita y no acepta casos arrastrados.
- **Comodín:** horario fijo 06–16, 07–17 u 08–18. Aparece en todos los turnos que su horario toca.
- **Almuerzo:** es un elemento más de la columna (amarillo, no transferible). Se edita con el lápiz o en la planificación.
- **Casos:** un código existe una sola vez en todo el historial y solo lo tiene un técnico. Reasignar = arrastrarlo o
  volver a asignarlo y confirmar. Los casos no se borran: se **cierran** (y se pueden reabrir).
- **Historial:** foto del tablero al cierre de cada día operativo (la genera la base de datos a las 05:59) y
  búsqueda de casos en días anteriores (snapshots + bitácora).
- **Bitácora:** quién asignó, reasignó, cerró o planificó qué y cuándo. La escriben triggers de la base de datos: no se
  puede omitir, editar ni borrar desde la app.

Probar el snapshot sin esperar: `select public.generar_snapshot_operativo();` en el SQL Editor.

## Arquitectura

Cada capa solo conoce a la que tiene debajo:

```
sql/                Esquema, migraciones y datos de demostración (solo dev) de Supabase
tests/              Pruebas: dominio, app con Supabase simulado y SQL
.github/workflows/  Verificación (CI) y despliegue a GitHub Pages
docs/               Entornos y despliegue
src/
├── pages/          index.astro (Tablero · Historial · Bitácora) y login.astro: solo ensamblan componentes
├── layouts/        Layout.astro: HTML base y estilos globales
├── components/     Marcado Astro sin lógica (layout, board, metrics, history, audit, modals, auth, ui)
│                   Lo dinámico son <template> que el código clona (nunca innerHTML con datos)
├── scripts/        Comportamiento en el navegador
│   ├── main.ts     Arranque: comprueba sesión y conecta todo
│   ├── board/      Vistas del tablero (turno, técnico, incidente, almuerzo), eventos, drag & drop
│   ├── modals/     Un controlador por modal + assignFlow (reglas de asignación compartidas)
│   ├── history/    Historial: foto de un día y búsqueda
│   ├── audit/      Bitácora
│   ├── planning/   Planificación semanal (solo dispatch)
│   ├── features/   Pestañas, buscador, filtro por técnico, sesión, estado de conexión
│   ├── actions/    Casos de uso: llaman a services, avisan al usuario, recargan datos
│   └── ui/         Toast, sonido, portapapeles, tablas, formato de fechas
├── state/          Store único, sincronización con Supabase (Realtime + respaldo)
├── services/       Único lugar que habla con Supabase (repositorios, auth, realtime)
├── domain/         Reglas puras: turnos, disponibilidad, almuerzo, métricas, búsqueda (sin DOM ni Supabase)
├── styles/         SCSS por parcial; los colores están solo en abstracts/_variables.scss
└── types/          Tipos del dominio y `Resultado`
```

### Reglas del proyecto

- `domain/` no importa Supabase ni el DOM: se puede probar aislado.
- Solo `services/` habla con Supabase; devuelve `Resultado` (sin excepciones) con mensajes en español.
- Los componentes `.astro` solo tienen marcado; la lógica vive en `scripts/`, un archivo por responsabilidad.
- Los textos de usuarios (código, comentario, nombre) se asignan con `textContent`: no se interpreta HTML.
- Una acción de datos = repositorio → recarga → el store notifica → se redibuja.
- Los colores y el tema se cambian en `src/styles/abstracts/_variables.scss`

