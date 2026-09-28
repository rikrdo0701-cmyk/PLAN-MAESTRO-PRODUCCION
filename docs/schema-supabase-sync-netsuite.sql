-- =============================================================================
-- ESQUEMA SUPABASE — DELTA DE LA INGESTA NETSUITE (PROPUESTO, NO APLICADO)
-- =============================================================================
-- ESTE ARCHIVO NO SE EJECUTA TODAVIA. Es el delta que necesita
-- netsuite-restlet-supabase-sync.js para escribir, y sigue la misma regla que
-- docs/schema-supabase.sql: nada se mueve hasta que se apruebe.
--
-- De donde sale cada hueco (medido, no supuesto):
--   - El RESTlet escribe 7 tablas. En docs/schema-supabase.sql existen 4
--     (work_orders, operations, materials, machines). Faltan items, inventory y
--     sales_orders: no hay de donde leerlas, asi que se crean aqui.
--   - materials NO tiene linea de identidad. La ingesta identifica cada renglon
--     por el id de la linea de transaccion de NetSuite (comp.id), que es estable
--     y es el mismo criterio que operations.operation_id = 'ns-<mot.id>'. Sin
--     columna no hay clave natural, y sin clave natural no hay upsert.
--   - machines NO lleva columna de tipo: `workcentertype` no existe en ninguna
--     fuente medible (ni SuiteQL ni REST Record API) y el usuario decidio que no
--     se necesita porque la maquina se captura en el plan (2026-09-28), asi que el
--     lector va contra `entitygroup` y guarda nombre + activa, sin descartar nada.
--
-- LO QUE ESTE ARCHIVO NO HACE, A PROPOSITO:
--   - No crea indices ni trigers nuevos mas alla de los indispensables para el
--     upsert: el indice de la clave natural lo crea el UNIQUE.
--   - No mete datos. Crea la forma; la ingesta mete el contenido.
--   - No toca RLS mas que para dar SELECT a anon a las tres tablas nuevas, por
--     el mismo motivo que las otras 21: la web lee, no escribe. Quien escribe es
--     el RESTlet, con la service role key, que salta RLS.
--
-- COMO SE APLICA (cuando se apruebe), y COMO SE COMPRUEBA ANTES:
--   1. Correr el RESTlet con  { accion: 'diagnostico' }. NO escribe nada: dice
--      que tablas existen y con que status. Si items/inventory/sales_orders
--      aparecen en `tablasFaltantes`, este archivo es exactamente lo que falta.
--   2. Aplicar este archivo (SQL Editor de Supabase, o `psql`).
--   3. Volver a correr `diagnostico`: las 7 deben dar existe:true.
--   4. Correr el RESTlet con  { accion: 'workorders', folios: ['<folio>'],
--      dryRun: true }. Sigue sin escribir: devuelve clavesQueSeEscribirian y
--      filasQueSeEscribirian, que son EXACTAMENTE las columnas de este esquema.
--      Si aparece una columna que no esta aqui, PostgREST dara 400 al escribir y
--      ese dryRun es la forma de verlo antes.
--   5. Recien ahi, la corrida real sin dryRun.
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- =============================================================================
-- 1. items — CATALOGO DE ARTICULOS
-- -----------------------------------------------------------------------------
-- Lector: SuiteQL `from item i`. Clave natural: i.itemid, que es el codigo con el
-- que la web y el planeador se refieren a un articulo.
-- MEDIDO 2026-09-28 con `SELECT * FROM item` (las 62 columnas reales, ver RULE-SUP-009):
-- la columna del tipo se llama `itemtype` y es un ENUM DE TEXTO, no un id. Sus 2522
-- articulos dan `Assembly` 1591, `InvtPart` 675, `NonInvtPart` 238, `Service` 14,
-- `OthCharge` 3, `Kit` 1. Por eso `tipo` es TEXT y no integer: guardar el enum con
-- num() lo dejaria en 0 en las 2522 filas SIN que la consulta de error.
-- `clase` SI es numerico (i.class) y se guarda crudo, pero OJO: 2470 de los 2522
-- articulos la tienen en NULL, o sea que `clase` valdrá 0 en la mayoria.
-- `es_ensamblaje` NO tiene columna propia: en `item` no existe `isassortmentitem` ni
-- `isassemblyitem` (ambos 500 medido). La unica fuente es el tipo, y por decision del
-- usuario del 2026-09-28 SOLO `Assembly` cuenta como ensamble padre; un `Kit` es un
-- ensamble de articulo, no un padre, asi que queda en false.
-- =============================================================================
create table if not exists public.items (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique,      -- i.itemid
  descripcion        text not null default '',  -- i.description
  descripcion_compra text not null default '',  -- i.purchasedescription
  nombre_mostrado    text not null default '',  -- i.displayname
  tipo               text not null default '',  -- i.itemtype CRUDO: Assembly | InvtPart | NonInvtPart | Service | OthCharge | Kit
  clase              integer not null default 0,-- i.class (crudo; NULL en 2470 de 2522)
  es_ensamblaje      boolean not null default false,  -- (i.itemtype = 'Assembly'), decidido 2026-09-28
  inactivo           boolean not null default false,  -- i.isinactive
  ultima_modificacion timestamptz,
  revision           integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- =============================================================================
-- 2. inventory — EXISTENCIAS POR (ITEM, UBICACION)
-- -----------------------------------------------------------------------------
-- Lector: SuiteQL `from aggregateitemlocation ail`. MEDIDO 2026-09-28: el agregado trae
-- YA una fila por par (articulo, ubicacion) - 2426 filas y 2426 pares distintos en toda la
-- cuenta, 1946 en la planta 1 y 3 ubicaciones -, asi que NO hay `SUM` ni `GROUP BY`: el
-- `BUILTIN.DF` no se puede usar en la proyeccion de una consulta agregada (da 400 *Busqueda
-- invalida o no compatible*) y sin el agregado el envoltorio si funciona y da el codigo del
-- articulo y el nombre de la planta. El lector igual suma en JS y avisa, para no romper el
-- `unique (item, ubicacion)` si algun dia hay dos renglones del mismo par.
-- `comprometido` sale de `ail.quantitycommitted`. NO existe `ail.quantityreserved`.
-- NO HAY USER EVENT PARA ESTA TABLA, y no es un descuido: `aggregateitemlocation`
-- es un agregado, no un registro que alguien guarde. Un User Event no dispara
-- "el inventario cambio" porque no existe el momento del guardado. Su disparador
-- es netsuite-scheduled-sincronizacion.js (barrido). Ver RULE-SUP-006.
-- La clave natural es COMPUESTA (item, ubicacion): una fila por par, que es como
-- el agregado ya viene. Sin ese UNIQUE no hay on_conflict posible.
-- =============================================================================
create table if not exists public.inventory (
  id          uuid primary key default gen_random_uuid(),
  item        text not null,                    -- BUILTIN.DF(ail.item) = el codigo (itemid)
  ubicacion   text not null,                    -- BUILTIN.DF(ail.location) = 'Planta MM del Llano'
  disponible  numeric not null default 0,       -- ail.quantityavailable
  fisico      numeric not null default 0,       -- ail.quantityonhand
  comprometido numeric not null default 0,      -- ail.quantitycommitted (NO existe quantityreserved)
  -- SIN FUENTE. Se queda en 0 a proposito y el lector lo avisa (RULE-SUP-009). La cantidad
  -- pickeada SI existe, pero en `transactionline.quantitypicked` (52 columnas, medido) y es
  -- el renglon de OT / SO / TrnfrOrd que se pickeo, no un estado de existencias por
  -- (articulo, ubicacion): en esta cuenta lo tienen 37481 lineas y NINGUNA es de tipo
  -- ItemShip (0 de 33330), y `transaction.ordpicked` es un booleano, no una cantidad.
  pickeado    numeric not null default 0,
  en_transito numeric not null default 0,       -- ail.quantityintransit
  revision    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (item, ubicacion)
);

-- =============================================================================
-- 3. sales_orders — ORDENES DE VENTA
-- -----------------------------------------------------------------------------
-- Lector: SuiteQL `from transaction t where t.type = 'SalesOrd'`.
-- Una fila por orden, con las lineas dentro en `lineas` (jsonb). Se eligio jsonb
-- y no una tabla `sales_order_lines` para que la escritura de la ingesta sea UNA
-- llamada por orden. Si algun dia hace falta consultar por renglon (inventario
-- comprometido, reporte por articulo), se parte en otra tabla: no se resuelve
-- con un jsonb que ya tiene filas.
-- =============================================================================
create table if not exists public.sales_orders (
  id             uuid primary key default gen_random_uuid(),
  folio          text not null unique,         -- t.tranid
  sales_order_id text not null default '',     -- t.id
  cliente        text not null default '',     -- BUILTIN.DF(t.entity)
  cliente_id     integer not null default 0,   -- t.entity (crudo)
  fecha          date,                          -- t.trandate
  estatus        text not null default '',      -- BUILTIN.DF(t.status)
  aprobacion     text not null default '',      -- BUILTIN.DF(t.approvalstatus)
  total          numeric not null default 0,    -- t.foreigntotal
  moneda         integer not null default 0,    -- t.currency
  memo           text not null default '',      -- t.memo
  lineas         jsonb not null default '[]'::jsonb,
  revision       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- =============================================================================
-- 4. materials.line_id — LA IDENTIDAD QUE FALTA
-- -----------------------------------------------------------------------------
-- Es lo unico que se ALTEREA de una tabla que ya existe, y es la pieza que hace
-- que `materiales` sea upsertable. Sin esto el RESTlet tendria que borrar y
-- reinsertar la lista completa de cada OT en cada corrida, que es peor que
-- cualquier cosa: dos corridas concurrentes se pisarian.
--
-- El id de la linea de transaccion (comp.id) es el MISMO criterio que ya usa
-- operations.operation_id ('ns-' + mot.id): un id interno de NetSuite, estable
-- entre corridas y unico por renglon.
--
-- Es NOT NULL porque una fila sin linea no tiene identidad: el RESTlet descarta
-- esas filas y lo avisa, en vez de empujar una fila que despues no se puede
-- actualizar. `add column ... not null` sobre una tabla que ya tuviera filas
-- fallaria, asi que primero se agrega nullable, se rellena y despues se aprieta;
-- en un proyecto sin datos (que es el caso) se puede aplicar de una vez.
-- =============================================================================
alter table public.materials add column if not exists line_id text;
update public.materials set line_id = id::text where line_id is null;
alter table public.materials alter column line_id set default '';
alter table public.materials alter column line_id set not null;
alter table public.materials add constraint materials_line_id_key unique (line_id);

-- =============================================================================
-- 5. MACHINES TIPO — DECISION DEL USUARIO: NO SE AGREGA
-- -----------------------------------------------------------------------------
-- La version anterior de este delta agregaba `machines.tipo integer`. Se REVOCA:
-- `workcentertype` no existe como columna de SuiteQL ni como campo de la REST
-- Record API (404 en el record type `workcenter` y variantes, medido el
-- 2026-09-28), y el usuario decidio que el dato no se necesita porque la maquina
-- se captura en el plan. El lector de centros lee `entitygroup`
-- (ismanufacturingworkcenter = 'T') y guarda solo `nombre` y `activa`.
-- =============================================================================

-- =============================================================================
-- 6. REVISION EN LAS TABLAS NUEVAS
-- -----------------------------------------------------------------------------
-- El resto del esquema lleva `revision integer not null default 0` y escribe con
-- `WHERE revision = eq.<anterior>` (concurrencia optimista, seccion 3.5 del plan).
-- Las tres tablas nuevas nacen con la misma columna para que el RESTlet pueda
-- usar el mismo modo `comparar` en las siete, sin excepciones por tabla.
-- =============================================================================

-- =============================================================================
-- 7. RLS DE LAS TRES TABLAS NUEVAS
-- -----------------------------------------------------------------------------
-- Mismo criterio que el bloque de docs/schema-supabase.sql: la web lee con la
-- clave anon, y NADIE escribe desde la web. Quien escribe es el RESTlet de
-- NetSuite con la service role key, que se salta RLS. No se da politica de
-- escritura a anon a proposito: si la web pudiera escribir, podria pisar el plan.
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['items','inventory','sales_orders']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "lectura_web" on public.%I for select to anon using (true)', t);
  end loop;
end
$$;

-- =============================================================================
-- 8. INDICES MINIMOS
-- -----------------------------------------------------------------------------
-- Los que la consulta de la ingesta y la lectura de la web piden de verdad. El
-- resto de los indices de docs/schema-supabase.sql no se tocan.
-- =============================================================================
create index if not exists idx_items_clase on public.items (clase);
create index if not exists idx_inventory_item on public.inventory (item);
create index if not exists idx_sales_orders_cliente on public.sales_orders (cliente);
create index if not exists idx_sales_orders_fecha on public.sales_orders (fecha desc);
-- materials ya tiene idx_materials_ot; lo que faltaba era el UNIQUE de line_id,
-- que es indice de por si (arriba, en la constraint).
