-- =============================================================================
-- PLAN MAESTRO DE PRODUCCION — ESQUEMA SUPABASE (desde 0)
-- Fuente del modelo: .project-memory/data-sources.json (19 hojas + 5 RESTlets).
--
-- TRES DECISIONES DE DISEÑO, Y POR QUE:
--   1. ID UNICO POR REGISTRO. Cada tabla tiene su id uuid (gen_random_uuid()) y su
--      clave natural con UNIQUE. Hoy la identidad es frágil: la clave de completado
--      es OP|<OT>|<secuencia>|<CT> y cambia cuando el planeador reenumera
--      (RULE-OT-031). Con un id estable por fila, la identidad no depende del orden.
--   2. REVISION POR FILA. La concurrencia optimista actual (CONFLICT_REVISION) vive
--      en CONFIG. Aqui cada tabla de datos operativos lleva su propia `revision`, y
--      cada escritura hace UPDATE ... WHERE revision = ?. Si no, se rechaza. Es el
--      mismo contrato, en Postgres.
--   3. UN ESCRITOR POR REPOSITORIO. Sigue siendo Apps Script (el unico con el OAuth
--      de NetSuite). Supabase es la fuente de verdad que lee la web; no escribe en
--      NetSuite. No se rompe la regla de un escritor.
--
-- LAS HOJAS DE HISTORIAL (PLANES_HISTORICOS, BORRADOR_PLAN, AUDITORIA) quedan en
-- Supabase como tablas de solo-append, igual que ahora: nadie las borra en medio.
-- =============================================================================

-- ---------------------------------------------------------------- extensiones
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ================================================================ CATALOGOS
-- Lectura caliente, escritura rara. Cada una con id unico y clave natural unica.

create table public.operators (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,          -- OPERADOR
  activo      boolean not null default true,
  minutos_capacidad integer not null default 2400,
  rendimiento_pct integer not null default 100,
  categoria   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.capabilities (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- KEY (p. ej. 5459::10OTD_:_DOBLEZ_DE_TUBERIA)
  ct          text not null default '',
  operacion   text not null default '',
  activa      boolean not null default true,
  capacidad   text not null default 'FINITA',
  solapamiento boolean not null default false,
  requiere_herramental boolean not null default false,
  requiere_kit boolean not null default false,
  eficiencia_pct integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.operation_catalog (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- KEY del catalogo maestro
  ct          text not null default '',
  label       text not null default '',
  source      text not null default 'NETSUITE',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Lo que la PLANIFICACION aparta de una maquina que NetSuite da por activa. Tabla
-- APARTE a proposito: `machines` la reescribe por completo el RESTlet 2246 cada 15
-- minutos (borra + inserta) y se llevaria cualquier columna que escribiera la app.
-- Decision del usuario 2026-09-29 (RULE-SUP-017). Solo se autoriza APARTAR, no
-- forzar el uso de una maquina que NetSuite da por inactiva.
create table public.machine_planning_overrides (
  id              uuid primary key default gen_random_uuid(),
  machine_nombre  text not null unique,      -- machines.nombre / hoja MAQUINAS.ID
  excluida        boolean not null default false,
  actualizado     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table public.machines (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,          -- nombre de la maquina
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.tools (
  id          uuid primary key default gen_random_uuid(),
  parte       text not null default '',
  herramental text not null default '',
  kit         text not null default '',
  tiempo_ajuste_herr integer not null default 0,
  tiempo_ajuste_kit integer not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.subcontracts (
  id          uuid primary key default gen_random_uuid(),
  parte       text not null default '',
  tipo        text not null default '',
  dias_habiles integer not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.ot_types (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.calendar_exceptions (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  concepto    text not null default 'GENERAL',
  maquina     text not null default '',
  motivo      text not null default '',
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fecha, concepto, maquina)
);

create table public.ot_configurations (
  id          uuid primary key default gen_random_uuid(),
  ot          text not null unique,          -- la OT
  maquina     text not null default '',
  kit         text not null default '',
  kit_pendiente boolean not null default false,
  tipo_subcontrato text not null default '',
  dias_subcontrato integer not null default 0,
  herramental text not null default '',
  herramentales_extra jsonb not null default '[]'::jsonb,
  actualizado  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.article_configurations (
  id          uuid primary key default gen_random_uuid(),
  articulo    text not null unique,
  tipo_ot     text not null default '',
  tipo_trabajo text not null default '',
  precio_manual numeric not null default 0,
  actualizado  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- La matriz: que operador esta habilitado para que capacidad. Es la que decide si una
-- operacion se puede programar (y por eso la que estaba vacia en 5493).
create table public.matrix (
  id          uuid primary key default gen_random_uuid(),
  capability_key text not null,
  operator    text not null,
  habilitado  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (capability_key, operator)
);

-- ================================================================ OPERATIVOS
-- Aqui vive la revision: cada escritura hace UPDATE ... WHERE revision = ?.

create table public.work_orders (
  id          uuid primary key default gen_random_uuid(),
  ot          text not null unique,          -- el folio
  wo_internal_id text not null default '',
  articulo    text not null default '',
  descripcion text not null default '',
  foto_url    text not null default '',
  fecha_inicio_ns timestamptz,
  fecha_fin_ns timestamptz,
  fecha_vencimiento timestamptz,
  cantidad    integer not null default 0,
  estatus     text not null default '',
  cliente     text not null default '',
  cant_ensamblada integer not null default 0,
  cant_pendiente integer not null default 0,
  precio_promedio_venta numeric not null default 0,
  precio_ultima_venta numeric not null default 0,
  revision    integer not null default 0,
  synced_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.operations (
  id          uuid primary key default gen_random_uuid(),
  operation_id text not null unique,         -- ns-<id>, el id estable de NetSuite
  ot          text not null,
  secuencia   integer not null default 0,
  ct          text not null default '',
  descripcion text not null default '',
  operador    text not null default '',
  maquina     text not null default '',
  herramental text not null default '',
  kit         text not null default '',
  cant_total  integer not null default 0,
  cant_pendiente integer not null default 0,
  tiempo_ciclo numeric not null default 0,
  tiempo_setup numeric not null default 0,
  tiempo_prod numeric not null default 0,
  fecha_inicio timestamptz,
  hora_inicio  timestamptz,
  fecha_fin   timestamptz,
  hora_fin    timestamptz,
  tipo_insercion text not null default 'OPERACION',
  estatus     text not null default 'PLAN',
  locked      boolean not null default false,
  auto_frozen boolean not null default false,
  subcontract_type text not null default '',
  subcontract_days integer not null default 0,
  revision    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.operation_plan_statuses (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- OP|<OT>|<secuencia>|<CT>
  ot          text not null,
  secuencia   integer not null default 0,
  ct          text not null default '',
  status      text not null default 'PENDIENTE',
  origin      text not null default 'draft',
  fecha_completado timestamptz,
  fecha_reapertura timestamptz,
  revision    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.materials (
  id          uuid primary key default gen_random_uuid(),
  ot          text not null,
  wo_internal_id text not null default '',
  ensamble    text not null default '',
  componente_id text not null default '',
  componente  text not null default '',
  descripcion text not null default '',
  unidad      text not null default '',
  requerido   numeric(18,6) not null default 0,   -- RULE-SUP-046: fraccionaria (BOM cantidad_por_unidad); era integer, el 2246 la redondeaba a 0
  emitido     numeric(18,6) not null default 0,   -- RULE-SUP-046: fraccionaria (quantityshiprecv); era integer
  pendiente   numeric(18,6) not null default 0,   -- RULE-SUP-046: max(0, requerido-emitido), la misma formula del 2244:363-366; era integer y el 2246 nunca la escribio
  revision    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ================================================================ ESTADO Y COLA

create table public.app_state (
  id          integer primary key default 1 check (id = 1),   -- una sola fila
  revision    integer not null default 0,
  saved_at    timestamptz,
  synced_at   timestamptz,
  plan_start  text not null default '',
  horizon_days integer not null default 15,
  report_week_start text not null default '',
  report_filters jsonb not null default '{}'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  plant       jsonb not null default '{}'::jsonb,
  operation_catalog_warning text not null default '',
  last_schedule jsonb,
  updated_at  timestamptz not null default now()
);

-- La cola, con POSICION. El orden manual vive en esta tabla, no en un array de CONFIG.
create table public.selected_ots (
  id          uuid primary key default gen_random_uuid(),
  ot          text not null unique,
  posicion    integer not null,              -- el orden manual
  added_at    timestamptz not null default now()
);

create table public.locked_ots (
  id          uuid primary key default gen_random_uuid(),
  ot          text not null unique,
  added_at    timestamptz not null default now()
);

create table public.closed_work_order_summaries (
  id          uuid primary key default gen_random_uuid(),
  ot          text not null unique,
  summary     jsonb not null,
  created_at  timestamptz not null default now()
);

create table public.unconfirmed_work_orders (
  id          uuid primary key default gen_random_uuid(),
  ot          text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  misses      integer not null default 1
);

-- Los snapshots del plan. El 'draft' es la autoridad del plan (RULE-PLAN-013).
create table public.plan_snapshots (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id text not null unique,          -- 'draft' o un uuid
  operations  jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  plan_start  text not null default '',
  version     text not null default '',
  usuario     text not null default '',
  change_summary jsonb,
  published_at timestamptz,
  publication_reason text not null default '',
  created_at  timestamptz not null default now()
);

-- ================================================================ INDICES
create index idx_operations_ot on public.operations (ot);
create index idx_operations_estatus on public.operations (estatus);
create index idx_work_orders_estatus on public.work_orders (estatus);
create index idx_matrix_capability on public.matrix (capability_key);
create index idx_materials_ot on public.materials (ot);
create index idx_selected_ots_posicion on public.selected_ots (posicion);
create index idx_plan_snapshots_generated on public.plan_snapshots (generated_at desc);

-- =============================================================================
-- ROW LEVEL SECURITY.
--
-- El aviso del editor es correcto: sin RLS, cualquiera con la clave anon puede leer y
-- escribir estas tablas. Se activa en TODAS.
--
-- EL MODELO DE ACCESO, y por que es asi:
--   - La WEB lee con la clave anon (publica). Por eso las politicas de SELECT a anon.
--     Los catálogos y los datos operativos no son secretos; la app es interna.
--   - La WEB NO escribe nada directamente. Quien escribe es Apps Script, con la
--     service role key, que SALTA RLS. Por eso no hay politica de INSERT/UPDATE/DELETE
--     para anon: si la web pudiera escribir, podria pisar el estado del plan.
--   - Quien necesite que la web escriba algo lo hace contra un RPC (funcion en
--     Supabase) que corra con SECURITY DEFINER, no dandole a la web poder de escritura.
--
-- OJO: la service role key es SECRETA y NO debe ir en el frontend. Si alguien la
-- filtra a un bundle, RLS no protege nada porque la service key lo salta. Va en
-- Apps Script (variables de script) y en el servidor, nunca en el navegador.
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'operators','capabilities','operation_catalog','machines','tools','subcontracts',
    'ot_types','calendar_exceptions','ot_configurations','article_configurations','matrix',
    'work_orders','operations','operation_plan_statuses','materials',
    'app_state','selected_ots','locked_ots','closed_work_order_summaries',
    'unconfirmed_work_orders','plan_snapshots','machine_planning_overrides'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    -- MEDIDO 2026-10-01: aqui decia `create policy "lectura_web" ... to anon`, o sea que reaplicar
    -- este archivo ABIERTA 23 tablas a cualquiera que abriera la pagina, sin avisar. Desde el
    -- 2026-09-30 la lectura exige sesion (schema-supabase-login-correo.sql) y este bloque tiene que
    -- dejar ese mismo estado, no el anterior. Se borran los DOS nombres antes del create: si solo
    -- se borra el que va a crear, quedan las dos politicas y gana la ultima.
    execute format('drop policy if exists lectura_web on public.%I', t);
    execute format('drop policy if exists lectura_app on public.%I', t);
    execute format(
      'create policy lectura_app on public.%I for select to authenticated using (true)', t);
  end loop;
end
$$;
