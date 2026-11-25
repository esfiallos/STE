# Panel NOC · Traspasos y Turnos — contexto rápido

Panel web en tiempo real para un NOC: casos (INC/SCTASK…) asignados a técnicos según su turno **del día**,
planificación semanal, almuerzos, seguimiento del técnico con notificaciones, historial diario (snapshots) y
bitácora. Roles: **dispatch** (asigna y planifica), **técnico** (tablero en solo lectura + su seguimiento y
traspaso) y **coordinador** (panel con estadísticas y alertas, buscador global; solo lee).
Todo el código, nombres y mensajes están **en español**; mantén ese idioma.

**Stack:** Astro 7 (sitio estático, sin SSR) · TypeScript estricto · SCSS · Supabase (Auth, Postgres, RLS,
Realtime, pg_cron) · Bun · Vitest (+ jsdom, + PGlite para SQL). Deploy: Cloudflare Workers (archivos estáticos,
`wrangler.jsonc`) desde GitHub Actions: `main` → `panel-noc` (base PROD), `desarrollo` → `panel-noc-dev` (base DEV).

---

## ▶ Cómo retomar en un contexto nuevo (leer primero)

1. Rama de trabajo: **`desarrollo`** (publica DEV en Cloudflare; `main` publica producción). `git log --oneline -8`.
2. Lee este archivo completo y luego `docs/DISENO_V2.md` (§2 día operativo, §3 modelo, §5 módulos, §7 fases,
   §8 decisiones D1–D37, §9 despliegue, §10 v2.1, §11 v2.2 calidad de vida, §12 v2.3, §13 v2.4 seguridad y casos perdidos, §14 v2.5 traspaso y colores, §15 v2.6 reparto por supervisión, §16 v2.7 planificación con aviso). Las decisiones de §8 ya las tomó el usuario: no las re-preguntes.
3. `bun run test` debe dar todo verde antes de tocar nada (hoy: 42 archivos, ~319 pruebas). En una máquina cargada
   vitest puede fallar al arrancar un worker ("Timeout waiting for worker"): repite ese archivo suelto.
4. Fases 1–18 hechas (`docs/DISENO_V2.md` §11–§16, reglas D16–D38, todas decididas). Migraciones 04–16
   y 17–18 aplicadas en DEV y PROD (verificado con el conector el 24/11/2026). Despliegue movido a Cloudflare el
   24/11/2026 (`docs/ENTORNOS_Y_DESPLIEGUE.md`, decisión en `docs/CLOUDFLARE.md`); falta la configuración de la
   cuenta, los secretos y las URL de Supabase (pasos del usuario, §1 de ese documento).
5. Al terminar cada fase: pruebas (dominio + app + SQL si hay migración), `bun run check`, `bun run test`,
   actualizar **este archivo** (sección Estado) y `docs/DISENO_V2.md` (tabla §7). El usuario hace el commit.
6. Hay un conector de Supabase disponible con los proyectos del usuario: úsalo solo para **leer** y solo si el
   usuario lo pide; nunca ejecutes migraciones ni escrituras en PROD sin su confirmación explícita.

## Estado (al 24/11/2026)

| Fase | Estado | Qué quedó |
|---|---|---|
| 1. BD v2 | ✅ | `sql/04_v2_modelo_base.sql` (aditiva) |
| 2. Dispatch v2 + corte | ✅ | `sql/05_v2_corte.sql`, planificación semanal, tablero por día operativo, "Por reasignar", filtro por técnico, roles |
| 3. Login | ✅ | Recuperar contraseña (panel en `/login/`), página `/restablecer/`, mejoras visuales |
| 4. Técnico | ✅ | `sql/06_v2_seguimiento.sql`, pestaña **Mi seguimiento**, campana de notificaciones + alertas, su columna resaltada |
| 5. Casos + Traspasos | ✅ | `sql/07_v2_traspasos.sql`, pestañas **Traspaso** y **Mis traspasos**, área/empresa en Mi seguimiento, etiqueta VM, recordatorios |
| 6. Coordinador | ✅ | `sql/08_v2_coordinador.sql`, pestañas **Panel** y **Buscar casos**, campana de alertas 2/4/6 h |
| 7. Ronda | ✅ | `sql/09_v2_ronda.sql`, botón **Asignar a la ronda** en Nuevo caso con vista previa del siguiente |
| 8. Planificación con solicitudes | ✅ | `sql/10_v2_planificacion.sql`, coordinación planifica; el dispatch pide permiso por día (campanas en ambos roles) |
| 9. Animaciones | ✅ | Tablero: FLIP al mover, entrada + destello del caso nuevo, pop del contador, realce de la columna (`ui/motion.ts`) |
| 10. Tablero del día | ✅ | §11.1–11.2, §11.12: tablero/panel solo con lo asignado hoy por dispatch (vacío a las 06:00), **Cancelar** (borra el caso) y **Editar** código/empresa del dispatch en lugar de cerrar, Empresa al crear, Bitácora solo dispatch/coordinación · `sql/11` |
| 11. Base visual | ✅ | §11.7–11.10: Inter + navy, `ui/confirmar.ts` (adiós `window.confirm`), `ui/fecha.ts`, combobox, `@formkit/auto-animate` + `motion` |
| 12. Seguimiento v2 | ✅ | §11.3–11.6: descripción única, última actualización = fecha + botón, filas horizontales, etiquetas propias locales (localStorage) con combobox, nota del traspaso = descripción · `sql/12` |
| 13. Filtros | ✅ | §11.11: tipo de caso (FRESH `#SR`/`#INC` · Tarea `SCTASK` · Incidente `INC`) + filtros técnico/área/estado/tipo |
| 14. Turno C por tramos y pulido | ✅ | §12: C1 22–00 / C2 00–06 (D29, `sql/14`), paletas de la tabla del traspaso (D30), destello al soltar, tarjetas sin superposición, quedarse un caso para mañana (D31, `sql/15`) |
| 15. Seguridad y casos perdidos | ✅ | §13: lectura solo con perfil (D32), turno terminado sin traspaso → "Por reasignar" + chip + alerta de coordinación (D33), aviso previo al técnico (D34), filtro/orden por tiempo sin actualizar, CSP + SRI (D35) · `sql/16` |
| 17. Reparto por supervisión | ✅ | §15: «Repartir…» en "Por reasignar" para dispatch y coordinación (D37, `sql/17`), el turno limita "Entregar a", buscadores que vuelven al estado normal |
| 18. Planificación con aviso | ✅ | §16: el dispatch planifica sin aprobación, da el motivo una vez por día y coordinación recibe el aviso con el detalle; almuerzo libre (D38, `sql/18`) |
| 16. Traspaso y colores | ✅ | §14: etiquetas "en manos de quién" (D36), estado y área con color, recordatorio opcional, receptor por turno + búsqueda, reparto "todos entran", historial en Buscar casos (también técnico) · sin SQL |

**Bases de datos (revisado con el conector el 22/11/2026).** Proyectos: PROD = `STE` (`kkslgsgapodpzuifjrwz`),
DEV = `DEV` (`bofqefbxziqxzrdujihd`).
- DEV y PROD: **04 a 15 aplicadas** (la 14 y la 15 el 22/11/2026) (verificado el 22/11/2026: `marcar_actualizado`, `traspaso_items.descripcion`/
  `actualizado_en`, `tipo_de_caso`, `tablero_del_dia.area`/`tipo`).
- Detalle 04–11 (vista `tablero_del_dia`, `cancelar_caso`, ronda con `p_empresa`, política
  `bitacora_leer_supervision`). Crons: `snapshot-operativo` 11:59 UTC (= 05:59 Honduras), `recordatorios-traspaso`
  y `alertas-coordinacion` cada 5 min. DEV tiene perfiles dispatch, técnico y coordinador; PROD aún no tiene
  coordinador ni casos/jornadas.
- 19/11/2026, a pedido del usuario: se vaciaron todas las tablas de `public` en DEV y PROD (casos, jornadas,
  técnicos, perfiles, traspasos, notificaciones, snapshots y bitácora). Se conservan los usuarios de `auth` y
  `entorno_dev` en DEV. El usuario las poblará al terminar la nueva arquitectura: sin perfiles nadie entra.
- 22/11/2026, a pedido del usuario: se volvió a vaciar `public` **y `auth.users`** en DEV y PROD y se crearon las
  cuentas reales (12 técnicos con su ficha en `tecnicos`, 3 dispatch, 1 coordinador; DEV además un coordinador de
  prueba). Sin casos ni jornadas. Las cuentas se crearon **sin contraseña** (la pone el usuario). Procedimiento para
  altas, cambios de rol y bajas
- DEV tiene el escenario de datos de prueba


## Lo que falta

### Fase 18 — Planificación con aviso ✅ (qué quedó)
- `sql/18_v2_planificacion_con_aviso.sql` (aplicada en DEV y PROD; requiere la 17): tabla
  `avisos_planificacion`, `avisar_cambio_planificacion(fecha, motivo)`, `aviso_de_planificacion(fecha)`,
  `puede_planificar` y `jornadas_validar_permiso` nuevos (D38). Retira las funciones de solicitudes (la tabla queda).
- Dominio `planningNotices.ts` (`diaEditable`, `pideMotivo`, `avisoVigente`, `avisosSinVer`, `describirAviso`,
  `describirCambio`, `novedadesDeAvisos`). `avisosPlanificacionRepo.ts`, `planningNoticeActions.ts`,
  `planningNoticesSync.ts`, `ui/pedirTexto.ts` (panel con campo; en las pruebas de app lo sustituye `app.pedirTexto`).
- UI: grilla editable para el dispatch, motivo al primer cambio de turno de un día (cancelar = no cambia nada),
  chip "Motivo indicado"/"Cambiado por dispatch", lista "Cambios del dispatch" (coordinación: "Visto"), campana de
  coordinación con los avisos sin ver. Sin campana de respuestas para el dispatch.
- Pruebas: `tests/sql/planificacion-con-aviso-v2.test.ts`, `tests/domain/avisos-planificacion.test.ts`,
  `tests/app/planificacion.test.ts`. `03_datos_demo_dev.sql` todavía no siembra avisos (sigue sembrando solicitudes).

### Fase 17 — Reparto por supervisión ✅ (qué quedó)
- `sql/17_v2_entrega_por_supervision.sql` (aplicada en DEV y PROD): `entregar_casos(p_entregas jsonb)` →
  interna `entregar_casos_en(p_entregas, p_ahora)` (revocada a la app). Ver `docs/DISENO_V2.md` §15.1.
- Dominio `supervisionHandover.ts` (`turnoTerminado`, `receptoresParaEntregar`, `repartirEntrega`, `Entrega`).
  Servicio `casosRepo.entregarCasos`, acción `entregarCasosPorSupervision`.
- UI: `components/modals/DistributeCasesModal.astro` + `scripts/modals/distributeModal.ts` (`iniciarModalReparto`,
  dispatch y coordinación; el botón `[data-action="repartir-por-reasignar"]` vive en la franja). La franja "Por
  reasignar" la ven dispatch y coordinación (sin arrastre en solo lectura).
- Traspaso: elegir turno quita al receptor de otro turno y elige solo si hay una persona. `ui/listaConBusqueda.ts`
  sin opción vacía (vaciar el texto no quita lo elegido). Buscar casos: `limpiarBusqueda()` al vaciar el campo o con Esc.
- Pruebas: `tests/sql/entrega-por-supervision-v2.test.ts`, `tests/domain/entrega-supervision.test.ts`,
  `tests/app/reparto-supervision.test.ts`; `tests/helpers/app.ts` inicia el modal para dispatch/coordinación.

### Fase 16 — Traspaso y colores ✅ (qué quedó) · sin migración
- Etiquetas (D36): `ETIQUETAS_SUGERIDAS` nuevas, `colorDeEtiqueta` normaliza y da color parecido a las anteriores
  (`COLORES_DE_ETIQUETA`); el reporte colorea por clave de color (`TemaCorreo.etiquetas`).
- Colores de estado y área: `$colores-estado`, `$colores-area` (`_variables.scss`), `components/_case-colors.scss`,
  `scripts/ui/colorDeCaso.ts` (`pintarEstado`, `pintarArea`, `colorearLista`), `claveDeArea` (`domain/areas.ts`).
- Traspaso: casilla `conRecordatorio`; listas `turnoReceptor` + `receptor` (`gruposDeReceptores`,
  `grupoDeReceptor` en `handoverDraft.ts`); búsqueda `ui/listaConBusqueda.ts`; receptores en `<details>` con resumen
  `#handoverReceiversSummary`. El turno elegido y el recordatorio abierto son estado de pantalla (mapas del módulo).
- Historial: fuera de Mi seguimiento (botón → `abrirEnBuscador`, que pasa `main.ts`); Buscar casos para técnicos
  (`[data-busqueda]` en la pestaña).
- Pruebas: `tests/app/traspaso.test.ts` (turno/búsqueda, reparto, recordatorio; las que editan esperan su guardado
  automático para no pisar la siguiente), `tests/app/seguimiento.test.ts`, `tests/domain/{traspaso,seguimiento}.test.ts`.
- **Verificado en el navegador contra DEV el 23/11/2026** (`bun run dev`; el usuario inicia sesión): dispatch (drag & drop
  y sus animaciones, "Por reasignar" con motivo, colores, Buscar con filtro de atraso) y técnico (Mi seguimiento,
  historial → Buscar, Traspaso con turno/búsqueda/reparto/recordatorio, campana) y coordinación (Panel, alertas,
  campana, tablero en solo lectura, planificación). Corregido en esa prueba: un caso "sin traspaso" ya no repite su
  "N h sin actualización" en Panel/campana (`alertasActivas`; atenderlo marca ambas), tarjetas no arrastrables en
  solo lectura, subtítulo de alertas actualizado, barra de
  pestañas que desbordaba en pantallas angostas, color de "Resuelto" en el tablero, y el filtro/orden "sin
  actualizar" ahora cuentan desde la última actualización (`horasDesdeLaActualizacion`, igual que el "hace N").
- Si en un equipo no se ven las animaciones: Windows con *Efectos de animación* apagado → `prefers-reduced-motion`
  → la app las apaga a propósito (`_base.scss`, `motion.ts`). El arrastre HTML5 no se puede probar con el mouse
  simulado del navegador del panel: se prueba despachando `dragstart/dragover/drop/dragend`.

### Fase 15 — Seguridad y casos perdidos ✅ (qué quedó) · auditoría del 23/11/2026
- `sql/16_v2_proteccion_de_casos.sql` (aplicada en DEV y PROD el 23/11/2026): `tiene_perfil()`; `casos`, `caso_responsables`,
  `jornadas`, `tecnicos` y `tecnicos_de_la_ronda()` solo para usuarios con perfil (antes cualquier sesión, D32).
  `gracia_cierre_de_turno()` (30 min), `turno_sin_traspaso(tecnico, fecha, desde, ahora)`, `casos_abiertos` +
  `sin_traspaso_desde` al final, alerta `turno_sin_traspaso`, notificación `cierre_pendiente`,
  `vigilar_cierres_de_turno()` (cron **`cierres-de-turno`** cada 5 min: alertas D33 + aviso previo D34).
- Dominio: `motivoPorReasignar` (`assignments.ts`; "Por reasignar" suma los de un turno sin traspaso),
  `horasSinActualizar`/`ordenarPorAtraso` (`followUp.ts`), filtro `atraso` (`caseFilters.ts`: +2/+4/+6 h, +1 día,
  "Quedó sin traspaso"), alerta crítica primero (`coordination.ts`).
- App: franja "Por reasignar" con el motivo; chip "Sin traspasar desde…" en Mi seguimiento; selector **Ordenar**
  (`#followUpOrder`); filtro "Sin actualizar" en Mi seguimiento y Buscar casos; el aviso `cierre_pendiente` abre la
  pestaña Traspaso.
- `Layout.astro`: CSP por `<meta>` solo en producción (`connect-src` = el Supabase de `PUBLIC_SUPABASE_URL`) y SRI de
  Font Awesome. Verificado con `astro preview` (config `panel-preview`, puerto 4322) y variables de prueba: login OK,
  sin violaciones. El panel con sesión no se pudo ver (sin `.env.production` local).
- Pruebas: `tests/sql/proteccion-de-casos-v2.test.ts` y casos nuevos en `tests/domain/{filtros,coordinacion,
  metricas-asignaciones-busqueda}.test.ts`, `tests/app/{tablero,seguimiento}.test.ts`.
- Pendiente del usuario: desactivar *Allow new users to sign up* en DEV y PROD si aún no
  (`docs/ENTORNOS_Y_DESPLIEGUE.md` §1 paso 9).

### Fase 5 — Casos + Traspasos ✅ (qué quedó)
- `sql/07_v2_traspasos.sql`: áreas fijas (`areas_de_caso()` = `domain/areas.ts`), el técnico edita área y empresa
  (`cliente`), `casos.actividad_tecnico_en` (la escribe el trigger con cualquier edición del técnico), recordatorio
  (`traspaso_items` → `casos.recordatorio_*`, `generar_recordatorios()` por pg_cron cada 5 min, aviso tipo
  `recordatorio` al inicio del turno del responsable), `traspaso_items.fecha_destino`, vista `casos_abiertos` +3 columnas.
- Dominio: `handoverBalance.ts` (reparto con candados), `handoverReport.ts` (Outlook/texto/TSV, todo escapado),
  `handoverDraft.ts` (receptores, borrador precargado, problemas para cerrar turno). `services/traspasosRepo.ts`.
- Pestaña **Traspaso** (`scripts/handover/handoverView.ts`): el borrador se crea al primer cambio y se guarda solo;
  repartir sin receptor / rebalancear / deshacer, vista previa en `iframe sandbox`, copiar (Outlook usa el evento
  `copy`, sin `innerHTML`), **Cerrar turno** guarda y llama a `enviar_traspaso`.
- Pestaña **Mis traspasos** (`myHandoversView.ts`): entregados y recibidos de un día, con el reporte para copiar.
- Mi seguimiento: área (lista), empresa, chip de recordatorio y la nota de quien entregó.
- Límite conocido: un traspaso por técnico y día; si llegan casos después de enviarlo, la pestaña lo avisa y el
  dispatch debe reasignarlos.

### Fase 6 — Coordinador ✅ (qué quedó)
- `sql/08_v2_coordinador.sql`: rol `coordinador` (por SQL, sin `tecnico_id`) + `es_coordinador()`; lee traspasos e
  ítems de todos; `buscar_casos(termino, limite)` (código, empresa, área, nota, etiqueta, actualización, técnico actual
  o del historial; `%`/`_` literales; cerrados al final); `estadisticas_del_dia(fecha)`; tabla `alertas_coordinacion`
  (RLS solo coordinador, solo puede marcar `leida`, Realtime) que llena `generar_alertas_coordinacion()` (cron cada
  5 min): 2/4/6 h sin actividad, contando solo dentro del turno del responsable (`fin_de_turno()`); una actualización
  o un cierre deja leídas las anteriores. `generar_recordatorios()` ahora también avisa a coordinación si el
  responsable no tiene jornada ese día.
- Dominio `coordination.ts` (estadísticas, alertas activas: una por caso, la más grave). `coordinacionRepo.ts`,
  `traspasosRepo.listarTraspasosDelCaso`.
- Pestaña **Panel** (`scripts/coordination/coordinatorPanel.ts`, vista por defecto del coordinador): tickets del día
  por estado (se relee al cambiar los casos) y alertas por atender. Campana propia (`alertsBell.ts`): al abrir una
  alerta se atienden las del caso y se abre en el buscador.
- Pestaña **Buscar casos** (`scripts/caseSearch/caseSearchView.ts`, coordinador y dispatch): ficha con responsables y
  traspasos (nota de quien entregó).
- CSS: `body.rol-coordinador` + `[data-coordinador-only]`; `[data-supervision-only]` = dispatch o coordinador.

### Fase 7 — Ronda ✅ (qué quedó)
- `sql/09_v2_ronda.sql`: `ronda_estado` (puntero por día operativo y turno; leen dispatch y coordinación; Realtime),
  `hora_en_rango`, `turno_en_curso`, `clave_de_ronda` (= `domain/round.ts`, comparada con `collate "C"`),
  `tecnicos_de_la_ronda(ahora)` (jornada hoy, activo, en horario, fuera de almuerzo) y
  `asignar_a_ronda(codigo, nota)`: solo dispatch, rechaza códigos existentes (23505), bloquea el puntero, crea el caso
  (origen `dispatch`, notifica) y anota `asignado_por_ronda` en la bitácora. Asignar a mano no mueve el puntero.
- `domain/round.ts` (`siguienteEnRonda`, `turnoEnCurso`), `services/rondaRepo.ts`, `asignarIncidenteARonda`.
- Modal **Nuevo caso**: botón **Asignar a la ronda** (además de "Asignar al técnico") y "Siguiente en la ronda: X"
  (vista previa; decide la base). Un código ya en el tablero o en el historial se asigna a un técnico concreto.

### Fase 8 — Planificación con solicitudes ✅ (qué quedó) · reemplazada por la fase 18 (D38)
- `sql/10_v2_planificacion.sql`: `solicitudes_planificacion` (una pendiente por día; leen dispatch y coordinación; el
  dispatch solo puede marcar `respuesta_vista`; Realtime), `fin_del_dia_operativo()`, `puede_planificar(fecha)`,
  `solicitar_edicion_planificacion(fecha, motivo)` (dispatch) y `resolver_solicitud_planificacion(id, aprobar,
  respuesta)` (coordinación; la aprobación vence al terminar el día operativo en que se aprueba). `jornadas`: RLS
  (dispatch o coordinación, de hoy en adelante) + trigger `jornadas_validar_permiso` con mensajes claros. Sin usuario
  (SQL Editor, cron) no se limita. Todo en la bitácora.
- Dominio `planningRequests.ts` (`diaEditable` = `puede_planificar`, `estadoDelDia`, `problemaDeSolicitud`, textos,
  novedades para avisar). `services/solicitudesRepo.ts`, `actions/planningRequestActions.ts`.
- Planificación (`planningView.ts`): pestaña para dispatch y coordinación. Coordinación edita y copia la semana y
  responde las solicitudes ("Por responder", con respuesta opcional). El dispatch ve la grilla bloqueada salvo los
  días habilitados, y pide permiso (día de la semana visible + motivo). Chips en el encabezado
  ("Solicitud pendiente", "Editable hasta 06:00"), lista de recientes e insignia en la pestaña.
- Campanas: la de coordinación (`alertsBell.ts`) suma las solicitudes por responder; el dispatch tiene la suya
  (`planning/requestsBell.ts`) con las respuestas. `planningRequestsSync.ts` relee con Realtime y avisa.
- El almuerzo también es planificación: el dispatch lo cambia solo con permiso del día.

### Fase 9 — Animaciones ✅ (qué quedó)
- `domain/boardChanges.ts`: compara el **estado** de dos dibujos (no el DOM): casos nuevos, movidos, técnicos que
  reciben y contadores que cambian. Sin dibujo anterior o con cambio de día operativo no anima; colapsar, buscar o
  filtrar tampoco.
- `scripts/ui/motion.ts`: mide las tarjetas antes de `replaceChildren` y anima después: FLIP (Web Animations, se
  omite con movimiento reducido) y clases `is-entering`, `is-moved`, `is-receiving`, `is-popping`. Si se redibuja a
  media animación la retoma con `animation-delay` negativo. Lo usa `board/renderBoard.ts`.
- `styles/components/_motion.scss` (máx. 900 ms = `DURACION_ANIMACION_MS`); `_base.scss` las apaga con
  `prefers-reduced-motion`. Se animan también los cambios que llegan de otros usuarios (Realtime).

### Fase 10 — Tablero del día ✅ (qué quedó)
- `sql/11_v2_tablero_del_dia.sql`: `origenes_del_tablero()` (= `ORIGENES_DEL_TABLERO`) y vista `tablero_del_dia`
  (por caso y día, la última asignación del dispatch: dispatch/reasignación/reapertura; incluye cerrados). La usan
  `estadisticas_del_dia` y `generar_snapshot_operativo`. Trigger: el dispatch no puede cerrar. `cancelar_caso(caso,
  motivo)` (solo dispatch, solo casos del tablero de hoy y sin traspaso enviado; copia a la bitácora, borra en
  cascada y avisa al técnico con notificación `cancelado`, `caso_id` null). Corrección de código → bitácora
  `codigo_corregido`. `asignar_a_ronda(codigo, empresa)`. Bitácora: lectura solo dispatch/coordinación.
- App: `sync.ts` lee `listarTableroDelDia(fecha)` → `incidentes` (columna = a quién lo asignó el dispatch; un
  traspaso no lo mueve). "Por reasignar" sale de `casosAbiertos` (`casosHastaElDia`) y solo la ve el dispatch.
  Tarjeta: empresa, chip de estado si no es "En curso", cerrado atenuado y sin arrastre; botones **Editar** y
  **Cancelar** (`modals/editIncidentModal.ts`, modal con motivo y aviso si el técnico ya lo trabajó). "Nuevo caso"
  y el formulario rápido piden **Empresa** (`casos.cliente`). Métrica "Casos asignados hoy". Pestaña Bitácora solo
  supervisión. El buscador del tablero también busca por empresa.
- No verificado en el navegador: necesita la 11 (y antes 07–10) aplicada en DEV.

### Fase 11 — Base visual ✅ (qué quedó)
- Tokens (`abstracts/_variables.scss`): paleta navy (`$navy-950…50`) sobre slate, Inter Variable empaquetada
  (`@fontsource-variable/inter`, importada en `layouts/Layout.astro`), radios 8/12 px, `$alto-campo`, `$color-foco`,
  `$sombra-flotante`. `_base.scss` da un aspecto único a todos los campos con `:where()` (los componentes ajustan).
- `scripts/ui/animacion.ts`: único lugar que importa **Motion** (`animarEntrada/Salida/Fondo/Pulso/Sacudida`) y
  **auto-animate** (`animarLista`, solo listas que cambian de a un elemento: avisos, resultados del buscador). Sin
  soporte o con movimiento reducido no anima. Usado por modales, campana, confirmaciones, fecha y combobox.
- `scripts/ui/confirmar.ts`: `confirmar(opciones): Promise<boolean>`; con `ancla` = popover junto al botón, sin
  ancla = panel con fondo y `resumen`. Enter acepta, Esc/clic fuera cancelan, foco atrapado y devuelto. Reemplazó
  los 6 `window.confirm` (cerrar caso, cerrar turno con resumen por receptor, reasignar/reabrir, desactivar técnico,
  copiar semana con cuántas se reemplazan). En las pruebas de app lo sustituye un mock (`app.confirmar` recibe el
  texto del panel).
- `domain/dateInput.ts` (intérprete puro: h, m, pm, ayer, ±N, lun…dom, D, D/M[/AA], ISO; chips; calendario) +
  `scripts/ui/fecha.ts` (`mejorarCampoDeFecha(input, { direccion })`: oculta el `<input type="date">`, que sigue
  teniendo el valor y recibe `change`; chips, mini calendario, vista previa, ↑/↓). Usado en el recordatorio del
  traspaso (futuro, mín. hoy) y en Mis traspasos (pasado, máx. hoy).
- `scripts/ui/combobox.ts` (`mejorarCombobox(input, { opciones, permitirCrear, alCrear, vacio })`) +
  `filtrarOpciones`/`mismoTexto` en `domain/search.ts`. Usado en las etiquetas de Mi seguimiento y Traspaso (sin
  datalist). Las etiquetas propias locales (localStorage) llegan en la fase 12 vía `alCrear`.
- Pruebas: `tests/domain/fechas-rapidas.test.ts`, `tests/app/componentes-ui.test.ts`.
- Visto en el navegador solo el login (fuente y colores nuevos, sin errores): el panel requiere iniciar sesión.

### Fase 12 — Seguimiento v2 ✅ (qué quedó)
- `sql/12_v2_seguimiento_descripcion.sql`: el técnico edita `casos.descripcion` (≤ 2000); el trigger marca
  `ultima_actualizacion_en/por` (y `actividad_tecnico_en`) con cualquier edición del técnico, con
  `marcar_actualizado(caso)` (solo el responsable, caso abierto; usa `app.marcar_actualizado`) y con la descripción
  que cambia al enviar un traspaso. `ultima_actualizacion` (texto) ya no se escribe: la migración copió su contenido
  a la descripción vacía (+1 entrada `migracion_descripcion` en la bitácora). Bitácora `descripcion_cambiada`.
  `traspaso_items.descripcion` + `actualizado_en` (foto al enviar). `enviar_traspaso` exige descripción (la del ítem o,
  si está vacía, la del caso) y la guarda en el caso.
- Dominio: `followUp.ts` (`sinDescripcion`, `nivelDeAtraso` 0/2/4/6 h, `haceCuanto`, `momentoCorto`,
  `ETIQUETAS_SUGERIDAS` + `Seguimiento`, `colorDeEtiqueta`, `agregarEtiquetaPropia`, `opcionesDeEtiqueta`).
  `ItemTraspaso.descripcion` reemplaza a `notaPersonalizada`/`ultimaActualizacion`; `combinarBorrador` toma siempre la
  descripción del caso (una sola nota). Reporte: "Últ. act.: 21/11 14:05" (fecha, no texto).
- Mi seguimiento (`followUpView.ts`): una **fila** por caso (código + chips · empresa · área · estado · etiqueta ·
  descripción de una línea que crece al enfocarla · "hace N min" + botón **Actualizado** · historial/copiar), grupos
  plegables con contador, borde por atraso, refresco de los tiempos cada 60 s sin redibujar. Ctrl+Enter o salir del
  campo guarda; Esc deshace. Insignia = casos sin descripción. Bajo 1180 px la fila usa dos líneas; en móvil, tarjeta.
- Traspaso: un solo campo **Descripción** (se guarda en el caso al salir del campo; la misma de Mi seguimiento).
  Ya no hay "nota para quien recibe" ni "última actualización" escrita; `notasDeTraspasosRecibidos` se quitó.
- Etiquetas: `scripts/ui/etiquetas.ts` (combobox con sugeridas + propias en `localStorage`
  `panel-noc:etiquetas-propias`, color por etiqueta con `tag-color--*`; tokens `$colores-etiqueta`).
- Pruebas: `tests/sql/seguimiento-descripcion-v2.test.ts` (incluye que cada receptor ve el caso en `casos_abiertos`,
  mismo día y día siguiente) y en `tests/app/traspaso.test.ts` "cada receptor ve el caso en su Mi seguimiento". El
  backend simulado ya elige la fecha destino por la jornada del receptor desde el día del traspaso.
- No verificado en el navegador (sin sesión).

### Fase 13 — Filtros ✅ (qué quedó)
- `sql/13_v2_filtros.sql`: `tipo_de_caso(codigo)` (= `domain/caseType.ts`, prueba de coincidencia en
  `tests/sql/tablero-del-dia-v2.test.ts`) y `tablero_del_dia` + `area`, `tipo` al final.
- Dominio: `caseType.ts` (`#SR…`/`#INC…` → FRESH · `SCTASK…` → Tarea · `INC…` → Incidente · Otro; antes cualquier `#`
  era FRESH; `handoverBalance.ts` lo reexporta) y `caseFilters.ts` (`cumpleFiltros`, `filtrarCasos`, `conteoPorTipo`
  que respeta los demás filtros, `SIN_AREA`, `filtrosDesdeTexto`).
- `scripts/features/caseFilters.ts` (`crearBarraDeFiltros(contenedor, { clave, campos, tecnicos?, alCambiar })`):
  chips de tipo con contador, listas de técnico/área/estado, "Mostrando X de Y" y "Limpiar (n)"; recuerda por vista
  en `sessionStorage` (`panel-noc:filtros:<clave>`). `ui/tipoDeCaso.ts` pinta el chip de tipo.
- Dónde: **Tablero** (tipo/área/estado en `#boardFilters` → `appStore.filtrosTablero`; el técnico sigue en
  `#filterTech`; solo filtra tarjetas, no columnas), **Mi seguimiento** (tipo/área/estado), **Traspaso**
  (tipo/área/estado/receptor; solo oculta ítems, los problemas y el reporte siguen viendo todo), **Buscar casos**
  (tipo/área/estado/técnico actual, sobre los resultados ya traídos) y **Panel** (con filtros, las estadísticas se
  calculan con el tablero del día del store, mismo criterio D17; sin filtros, `estadisticas_del_dia`; las alertas se
  filtran y la insignia cuenta todas). Chip de tipo en tarjetas del tablero y filas del seguimiento.
- Pruebas: `tests/domain/filtros.test.ts`, `tests/app/filtros.test.ts`.
- No verificado en el navegador (sin sesión).


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
  index.astro          Panel · Tablero · Buscar casos · Mi seguimiento · Traspaso · Mis traspasos ·
                       Planificación · Historial · Bitácora (según rol)
  login.astro          Entrar + recuperar contraseña   ·   restablecer.astro: contraseña nueva
        │
scripts/               Comportamiento en el navegador
  main.ts              Arranque: sesión → perfil/rol → iniciar módulos → store.subscribe(render) → sync
  auth/                loginPage, resetPage, authUi (mostrar contraseña, Bloq Mayús, carga, sacudida)
  board/               Vistas del tablero (+ franja "por reasignar"), eventos, drag & drop, renderScheduler
  planning/            Planificación semanal (coordinación y dispatch editan; el dispatch avisa el motivo por día, D38)
  followUp/            Mi seguimiento del técnico (estado, etiqueta, última actualización, historial)
  notifications/       Campana del técnico: lista, no leídas, tiempo real, alertas de escritorio
  modals/              Un controlador por modal + assignFlow (reglas de asignación compartidas)
  features/            Pestañas (según rol), buscador, filtro por técnico, sesión, estado de conexión
  history/ audit/      Vistas de Historial y Bitácora
  actions/             Casos de uso: service → recarga (cargarDatos) → aviso/sonido
  ui/                  toast, sonido, portapapeles, tablas, formato, animacion (Motion + auto-animate),
                       confirmar (panel/popover), fecha (selector rápido), combobox
        │
state/                 appStore (createStore: get/set/subscribe) + sync.ts (Realtime + respaldo)
        │
services/              ÚNICO lugar que habla con Supabase. Repos devuelven Resultado<T>, nunca lanzan.
                       authService, perfilRepo, tecnicosRepo (catálogo), jornadasRepo, casosRepo,
                       notificacionesRepo, historialRepo, bitacoraRepo, realtime
        │
domain/                Reglas puras (sin DOM ni Supabase): time (día operativo, semanas), shifts, availability,
                       lunch, planning, handover (traspasos), followUp (seguimiento/notificaciones), credentials,
                       metrics, search, assignments, audit, caseType, caseFilters, dateInput
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
- Casos y técnicos **no se borran**: los casos se cierran, los técnicos se desactivan. Única excepción (D25, fase
  10): **Cancelar** del dispatch borra un caso asignado por error, vía RPC y con copia en la bitácora.
- Reglas duplicadas a propósito en SQL y TS, con prueba que verifica que coincidan:
  `desfase_traspaso()` = `domain/handover.ts`; horarios de comodín y de C (`jornada_horario_valido`,
  `horarios_turno_c()`) = `HORARIOS_COMODIN` / `HORARIOS_TURNO_C`.
- Navegar con `irA()` (`scripts/routes.ts`), no con `window.location.replace` directo (las pruebas lo sustituyen).

## Dominio clave

- **Día operativo** 06:00 → 06:00 (Honduras): `fechaOperativa()` / `public.fecha_operativa()`. A las 06:00 el
  tablero queda limpio sin borrar nada; los casos abiertos de un responsable que no trabaja hoy salen en
  "Por reasignar" (solo dispatch). **D16:** el tablero y el panel muestran solo lo que el dispatch asignó en el día
  (vista `tablero_del_dia`, incluye cerrados); lo traspasado y lo de días anteriores vive en Mi seguimiento.
- El dispatch **no cierra** casos: edita código/empresa o **cancela** (D25, el caso deja de existir).
- "Última actualización" es una **fecha** (cualquier edición del técnico o el botón Actualizado) y el texto del caso
  es la **descripción**, que es también la nota del traspaso (D19–D21, fase 12).
- Turnos: A 06–14, B 14–22, C por tramos **C1 22–00** y **C2 00–06** (toda la noche = C1 + C2, D29).
  **Comodín**: 06–16, 07–17 u 08–18; aparece en los turnos que toca.
  El turno es **por día** (tabla `jornadas`), lo planifica el dispatch por semana; el almuerzo también.
- Destinos de traspaso: A → B/Comodín (mismo día) · B y Comodín → C (mismo día) o A/Comodín (día siguiente) ·
  C (cualquier tramo) → A/Comodín (día siguiente). Uno mismo cuenta como receptor solo para su turno de mañana (D31).
- Un técnico recibe casos solo si está `disponible` (en horario y fuera de almuerzo) → `domain/availability.ts`.
- Un código de caso existe una sola vez en todo el historial. Asignar uno cerrado ofrece reabrirlo.
- Estados: En curso · Pausado · Resuelto · Cerrado. Al cerrar turno todo lo no cerrado se traspasa (fase 5).
- El técnico solo puede cambiar estado, etiqueta, área, empresa y descripción de **sus** casos (trigger
  `casos_antes_de_guardar` + RLS); la BD registra quién y cuándo los tocó por última vez.

## Base de datos (`sql/`, se ejecutan a mano en el SQL Editor de Supabase, en orden)

- `01_schema_inicial.sql`, `02_migracion_v3.sql`: modelo anterior (histórico; la 05 lo retira).
- `04_v2_modelo_base.sql` (aditiva): día operativo, `perfiles` + roles (`es_dispatch()`, `mi_tecnico_id()`),
  `jornadas`, `casos` + `caso_responsables` (historial, lo escriben triggers), `notificaciones` (las crea un
  trigger al asignar/traspasar), `traspasos` + `traspaso_items` + `enviar_traspaso()`, `generar_snapshot_operativo()`.
- `05_v2_corte.sql`: resincroniza lo hecho con la app anterior, **borra** `incidentes` y el turno fijo de
  `tecnicos`, RLS de técnicos solo dispatch, vista `casos_abiertos` (security_invoker), cron 05:59.
  Rompe la app anterior: se ejecuta justo antes de publicar la v2 (ver `docs/DISENO_V2.md` §9).
- `06_v2_seguimiento.sql`: `casos_abiertos` suma `origen_responsable` y `ultima_actualizacion_por`.
- `07_v2_traspasos.sql`: áreas fijas, área/empresa del técnico, actividad del técnico, recordatorios (+ cron cada
  5 min), `fecha_destino` de los ítems, `enviar_traspaso` actualizado y `casos_abiertos` +3 columnas.
- `08_v2_coordinador.sql`: rol coordinador, `buscar_casos`, `estadisticas_del_dia`, `alertas_coordinacion` (+ cron
  `alertas-coordinacion` cada 5 min). Coordinador: `insert into perfiles (id, nombre, rol) ... 'coordinador'`.
- `09_v2_ronda.sql`: `ronda_estado` y `asignar_a_ronda()` (rotativa alfabética por turno, D10). Sin cron.
- `10_v2_planificacion.sql`: solicitudes de planificación y permisos de `jornadas` por día (D14, D15). Sin cron.
- `11_v2_tablero_del_dia.sql`: vista `tablero_del_dia`, estadísticas y snapshot por D16, el dispatch no cierra,
  `cancelar_caso()`, ronda con empresa, bitácora solo supervisión (D16–D18, D25, D26, D28). Sin cron.
- `12_v2_seguimiento_descripcion.sql`: descripción editable por el técnico, última actualización como fecha,
  `marcar_actualizado()`, `enviar_traspaso` con descripción, foto en `traspaso_items` (D19–D21). Sin cron.
- `13_v2_filtros.sql`: `tipo_de_caso()` y `tablero_del_dia` con `area` y `tipo` (§11.11). Sin cron.
- `14_v2_turno_c_variantes.sql`: tramos C1/C2 (`horarios_turno_c()`, `jornada_horario_valido`), inicio/fin de turno
  y ronda por tramo, `describir_turno` con el tramo (D29). Sin cron.
- `15_v2_traspaso_propio.sql`: `enviar_traspaso` acepta entregarse un caso a uno mismo para mañana (nuevo tramo en
  `caso_responsables`) y la carga en 0 ignora lo que ya es para un turno futuro (D31). Sin cron.
- `16_v2_proteccion_de_casos.sql`: lectura solo con perfil (D32), turno sin traspaso (D33), aviso previo (D34),
  `casos_abiertos.sin_traspaso_desde`. **Con cron** `cierres-de-turno` (bloque final, la prueba lo quita).
- `17_v2_entrega_por_supervision.sql`: `entregar_casos()` para dispatch y coordinación (D37). Sin cron.
- `18_v2_planificacion_con_aviso.sql`: el dispatch planifica sin aprobación y avisa el motivo por día (D38). Sin cron.
- `03_datos_demo_dev.sql`: solo DEV (requiere `public.entorno_dev`, requiere 04–14); escenario de prueba completo
  y repetible; no toca `perfiles` ni `auth`. Guía: `docs/interno/DATOS_DE_PRUEBA.md` (local, no se versiona).
- Roles: solo por SQL (`insert into perfiles ...`, ejemplo en la cabecera de la 04). Técnico = `rol 'tecnico'`
  **con** `tecnico_id`; sin él no tiene seguimiento ni notificaciones.
- Cambios de esquema → nuevo archivo `sql/0N_*.sql` idempotente + prueba en `tests/sql/` + agregarlo a
  `MIGRACIONES` en `tests/helpers/baseSql.ts`. Una vista solo admite columnas nuevas **al final**.

## Entornos

- `PUBLIC_APP_ENV` debe ser `development` en `astro dev`; `astro build` acepta `production` (base PROD) o
  `development` (DEV publicado); `services/environment.ts` aborta si no. DEV muestra insignia y título `[DEV]`.
  Cada workflow comprueba que `PUBLIC_SUPABASE_URL` sea del proyecto que le toca (`publicar.yml`).
- Variables: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (solo la clave publicable, nunca service_role).
  `.env*` está bloqueado para lectura (`.claude/settings.json`).
- Rutas siempre vía `RUTAS` (`scripts/routes.ts`), que respeta `BASE_PATH` (en Cloudflare vale `/`).
- Seguridad del sitio: `src/config/seguridad.ts` (CSP de la `<meta>` y `dist/_headers`, que escribe
  `astro.config.ts`). `dist/` está bloqueado para lectura en `.claude/settings.json`.
- CI: `ci.yml` (ramas/PR, solo verifica), `deploy.yml` (`main` → producción) y `deploy-dev.yml` (`desarrollo` →
  DEV), ambos vía `publicar.yml` (comprueba, compila, revisa `dist/` y `wrangler deploy`). Detalle en
  `docs/ENTORNOS_Y_DESPLIEGUE.md`.

## Pruebas (`tests/`, ninguna toca una base real)

- `domain/`: funciones puras.
- `app/`: la app real con jsdom (`// @vitest-environment jsdom`) contra `helpers/backendSimulado.ts`
  (stub de `fetch` que imita PostgREST: casos con `_fecha`/`_origen`, jornadas con upsert, vista casos_abiertos,
  notificaciones, caso_responsables). `helpers/app.ts`: `iniciarApp(datos, { rol, tecnicoId })`, `fijarHora`
  (lunes 9/11/2026), `esperar`. Páginas de acceso: `tests/app/acceso.test.ts` (simula `authService` e `irA`).
- `sql/`: ejecuta los `.sql` en PGlite con un Supabase mínimo simulado (`helpers/baseSql.ts`: roles, auth,
  `actuarComo(uid)` para probar RLS; sin los bloques pg_cron).
- Usan `dist/` compilado: `bun run test` compila primero; si corres vitest suelto, haz `bun run build` antes.
