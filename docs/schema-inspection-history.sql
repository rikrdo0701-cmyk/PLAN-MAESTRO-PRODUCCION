-- =============================================================================
-- HISTORIAL DE IMPRESIONES DE INSPECCION
--
-- POR QUE ESTA TABLA. MEDIDO 2026-10-01: `recordInspectionPrint` (Apps Script,
-- 16-inspection-service.js:689) escribia una fila en la hoja
-- `HISTORIAL_IMPRESION_INSPEC` del libro INSPECTION_SPREADSHEET_ID, y
-- `getInspectionHistory` la leia de ahi. Con el puente de Apps Script
-- deshabilitado (RULE-SUP-030) las dos funciones no tienen a quien llamar: la hoja
-- sigue existiendo, pero nadie la escribe ni la lee desde la pagina. O sea que no
-- era un historial en otro lugar, era un historial SIN LUGAR: la impresion salia
-- igual porque la app trata el registro como no bloqueante, y nadie se enteraba de
-- que no se estaba guardando.
--
-- LO QUE SE MIGRA, EXACTAMENTE. Las doce columnas de la hoja, en el mismo orden
-- y con el mismo significado:
--   FECHA_HORA | WO | ARTICULO | CANTIDAD | ESTADO_TRABAJO | SEMAFORO | ALERTAS |
--   MATERIALES_PENDIENTES | MATERIALES_DEFICIT | SIN_DIBUJO | FALTA_TRAMO |
--   DETALLE_JSON
-- Ver PP_Inspection_historySheet_ (16-inspection-service.js:666), que es la
-- declaracion de esas columnas. `DETALLE_JSON` era el json de `detail` con
-- `operations` agregado; aqui es `detalle jsonb`, que es el mismo dato con tipo.
--
-- LAS COLUMNAS DE TEXTO LIBRE, Y POR QUE SIGUEN SIENDO TEXTO. `alertas`,
-- `materiales_pendientes` y `materiales_deficit` los escribia el servidor como
-- `'a | b | c'` con un separador literal, y `sin_dibujo` / `falta_tramo` como
-- `'SI'` / `'NO'`. Se conservan en texto y NO se parten en tablas hijas: la hoja
-- guardaba una linea por impresion y una persona la leia; partirla en tres tablas
-- seria cambiar el dato y el modo de leerlo sin que nadie lo pidiera. El `SI`/`NO`
-- se queda como texto por lo mismo, aunque un boolean sería mas comodo de filtrar:
-- lo que se lee hoy es `SI`, y cambiarlo a `true` cambia lo que se ve.
-- Lo que SI se indexa es lo que se busca: `ot`.
--
-- `printed_at` Y `fecha_hora`, Y POR QUE LAS DOS. `fecha_hora` es el texto que
-- escribia la hoja en `dd/MM/yyyy HH:mm:ss` con la zona del script, y es lo que ve
-- la pagina. `printed_at` es el instante, para ordenar y para auditar. Es el mismo
-- criterio de `inspection_routes.actualizado` / `actualizado_at` (RULE-INS-001), y
-- por la misma razon: un dato de texto libre que se muestra no se convierte, y el
-- instante se agrega aparte. El que escribe pone las dos del mismo reloj, asi que
-- no pueden discrepar.
--
-- QUE NO HACE ESTE ARCHIVO. No copia el historial que ya este en la hoja: eso lo
-- hace `PP_migrarHistorialInspeccionASupabase_` (16-inspection-service.js), que se
-- corre MANUALMENTE, UNA vez, y solo si hay historial que recuperar. La hoja no se
-- borra y queda congelada, como `Tramos`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La tabla. Idempotente.
-- -----------------------------------------------------------------------------
create table if not exists public.inspection_history (
  id                     uuid primary key default gen_random_uuid(),
  -- El folio de la OT. Es el indice: el historial se pide SIEMPRE por OT
  -- (`getInspectionHistory(wo)`), y es lo unico de la fila que no se puede inventar.
  ot                     text not null,
  -- Texto VERBATIM de la hoja. Es lo que muestra la pagina.
  fecha_hora             text not null default '',
  -- El mismo instante, con tipo. NULL solo si el reloj no estaba disponible, y en
  -- ese caso la fila dice la verdad: hay impresion pero no se sabe cuando.
  printed_at             timestamptz,
  articulo               text not null default '',
  cantidad               numeric not null default 0,
  estado_trabajo         text not null default '',
  semaforo               text not null default '',
  -- ' | ' entre cada uno, como en la hoja.
  alertas                text not null default '',
  materiales_pendientes  text not null default '',
  materiales_deficit     text not null default '',
  -- 'SI' / 'NO', no booleano: ver la cabecera.
  sin_dibujo             text not null default 'NO',
  falta_tramo            text not null default 'NO',
  -- El `detail` que mandaba la pagina, con las operaciones agregadas por el
  -- servidor. jsonb y no text para que se pueda consultar sin parsear en el
  -- servidor, y el contrato de la pagina no cambia: sigue siendo un objeto.
  detalle                jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.inspection_history is
  'Historial de IMPRESIONES de la hoja de inspeccion. Migrado de la hoja '
  'HISTORIAL_IMPRESION_INSPEC del libro INSPECTION_SPREADSHEET_ID, que queda '
  'congelada. Un solo escritor: la pagina (PPSupabaseWriter.guardarInspectionPrint). '
  'NO es la tabla de catálogos de tramos (inspection_routes).';

comment on column public.inspection_history.fecha_hora is
  'Texto de "FECHA_HORA" de la hoja, VERBATIM en dd/MM/yyyy HH:mm:ss. Es lo que ve '
  'la pagina; por eso no es timestamptz. El instante con tipo es printed_at.';

comment on column public.inspection_history.sin_dibujo is
  '''SI'' o ''NO''. Texto y no boolean porque es lo que se leia antes; el lector de la '
  'pagina acepta las dos formas, pero la columna guarda lo que guardaba la hoja.';

comment on column public.inspection_history.detalle is
  'El `detail` que mando la pagina al registrar, con `operations` agregadas. Es el '
  'detalle completo de esa impresion: por que se imprimio como se imprimio.';

-- -----------------------------------------------------------------------------
-- 2. Indices. Uno por `ot`, que es la unica busqueda que hace la pagina
--    (`getInspectionHistory` filtra por WO y toma las ultimas 5), y uno por
--    `printed_at` para el caso de "todas las impresiones de la planta", que es la
--    lectura que haria falta para una auditoria y que hoy no se puede hacer.
--
--    NO hay indice UNIQUE en ninguna columna, y es a proposito: una OT se puede
--    imprimir dos veces el mismo segundo, y un UNIQUE sobre (ot, fecha_hora) seria
--    un `on_conflict` que se traga la segunda impresion. Aqui no hay `on_conflict`:
--    cada impresion es una fila nueva, siempre. Por eso la tabla NO va en la
--    whitelist de ingesta_mirror (RULE-SUP-021: un espejo borra, y este es un
--    historial que se acumula).
-- -----------------------------------------------------------------------------
create index if not exists inspection_history_ot_idx on public.inspection_history (ot);
create index if not exists inspection_history_printed_at_idx on public.inspection_history (printed_at desc);

-- -----------------------------------------------------------------------------
-- 3. RLS: leer y escribir exige sesion, como el resto (RULE-SUP-015).
--    DROP + CREATE y no `create policy if not exists`, que PostgreSQL NO tiene
--    (RULE-SUP-037).
--
--    MEDIDO 2026-10-01 en las demas tablas: con la clave publica y sin sesion la
--    Data API responde HTTP 200 con CERO filas, no un error. Un historial que se lee
--    "vacio" sin decir por que parece que nadie ha impreso nunca, que es justo lo
--    contrario de lo que pasa.
-- -----------------------------------------------------------------------------
alter table public.inspection_history enable row level security;

drop policy if exists lectura_web on public.inspection_history;
drop policy if exists inspection_history_select_authenticated on public.inspection_history;
create policy inspection_history_select_authenticated
  on public.inspection_history for select
  to authenticated
  using (true);

drop policy if exists inspection_history_write_authenticated on public.inspection_history;
create policy inspection_history_write_authenticated
  on public.inspection_history for all
  to authenticated
  using (true)
  with check (true);

-- -----------------------------------------------------------------------------
-- 4. Disparador de updated_at: mismo patron que el resto de catalogos.
--    `public.pp_set_updated_at()` ya existe (docs/schema-inspection-routes.sql y los
--    demas DDL de catalogo); se declara aqui la FUNCION que usa, no la funcion.
-- -----------------------------------------------------------------------------
drop trigger if exists inspection_history_set_updated_at on public.inspection_history;
create trigger inspection_history_set_updated_at
  before update on public.inspection_history
  for each row execute function public.pp_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. LO QUE ESTE ARCHIVO NO HACE, DICHO.
--
-- No mete la fila en `public.ingesta_mirror_whitelist`, y a diferencia de
-- `inspection_routes` aqui es lo correcto: ese RPC es BORRA-E-INSERTA, y un
-- historial no se puede reponer borrando. Si alguna vez se quiere recuperar el
-- historial de la hoja, es con un INSERT del importador, no con el espejo.
--
-- No toca `inspection_routes`. Son dos cosas distintas: el CATALOGO de tramos
-- (inspection_routes, una fila por articulo+material, se edita a mano) y el
-- HISTORIAL de impresiones (esta tabla, una fila por impresion, la escribe la
-- pagina sola). Que las dos esten en el mismo archivo de la migracion de la
-- inspeccion es comodo; que compartan tabla seria un error.
--
-- No abre la escritura a anon. Una fila de este historial dice que OT se
-- imprimio, cuando y con que semaforo, y eso es informacion de produccion.
-- -----------------------------------------------------------------------------
