-- ============================================================================
-- La web lee y escribe en Supabase: columnas que faltan, el registro de
-- eventos, y permisos de escritura para el estado del plan.
--
-- OBJETIVO (RULE-SUP-023, decision del usuario 2026-09-29): 'la fuente de
-- informacion de lectura escritura es supabase, no usar appscript ni restlet para
-- mostrar datos en la web'. Este archivo es la parte de esquema que hace falta
-- para que eso sea posible. No apaga las Hojas: eso viene despues, y solo cuando
-- este DDL este aplicado y la web este leyendo y escribiendo aqui.
--
-- ============================================================================
-- EL DISEÑO, Y POR QUÉ ESCALA
--
-- La pregunta era 'usa el diseño mas adecuado con lo que ya conoces de la
-- estructura de la web y que sea escalable a mas tablas y mas informacion'. La
-- regla que se aplica, y que se escribe aquí para que no se pierda:
--
--   1. COLUMNA cuando el dato se filtra, se ordena o se compara. Tipada, con
--      indice si se busca. Ejemplos de este archivo: prioridad, fecha_req.
--
--   2. TABLA APARTE cuando el dato es un FLUJO: crece con el tiempo, se
--      consulta por slices, y no pertenece a una fila sino a una succession de
--      hechos. Ejemplo de este archivo: el registro de eventos.
--
--   3. JSONB cuando el dato es un objeto anidado que la app guarda y devuelve
--      entero, y nadie lo filtra por campo. MEDIDO: app_state ya lo hace asi con
--      settings, plant, report_filters y last_schedule, y plan_snapshots con
--      operations. No se inventan columnas para desarmar eso.
--
--   4. UN SOLO MECANISMO para escribir. No un RPC por tabla. Se REUSA
--      public.ingesta_mirror, que ya hace lo correcto para esto: borra la tabla
--      e inserta lo que le mandan, dentro de una transaccion. Agregar una tabla
--      nueva al sistema es agregar una linea a la whitelist del RPC, no escribir
--      SQL nuevo. Eso es lo que hace que 'mas tablas' sea barato.
--
--   5. LO QUE NO SE HACE: meter todo en un jsonb gigante por si acaso. Se
--      pierde la capacidad de filtrar y de indexar, y el dia que haga falta
--      consultar un campo hay que migrar datos.
--
-- ============================================================================
-- 1. LAS COLUMNAS QUE FALTABAN. MEDIDAS 2026-09-29 contra el esquema
--    desplegado, una por una. app_state, selected_ots, locked_ots,
--    operation_plan_statuses, plan_snapshots, unconfirmed_work_orders y
--    closed_work_order_summaries YA EXISTEN (corrige lo que se creia antes de que
--    fussieran solo de Hojas), pero estan VACIAS: nadie las ha escrito nunca.
-- ============================================================================
--
-- POR QUE LAS FECHAS SON text Y NO date. La hoja las guarda como texto y la app
-- las maneja como cadena, con valores que no son fechas ('SIN FECHA', ''). Una
-- columna date hace fallar el INSERT entero si un valor no entra, y el rollback
-- deja la tabla con los datos viejos: es exactamente lo que se quiere evitar
-- (RULE-SUP-021). Se usa text, la misma convencion que ya tiene app_state
-- (plan_start, report_week_start son text). Si mas adelante hay que filtrar por
-- fecha, la conversion se hace en el RPC con try_cast y no en la fila.
--
-- precio_desde y precio_hasta son text y NO numeric, y el nombre engaña: parece
-- una ventana de precio y es una ventana de FECHAS. MEDIDO 2026-09-29:
-- app.js:1726 hace averageSalePriceFrom: normalizeOtDate(item.averageSalePriceFrom ||
-- item.precioDesde), o sea que la app los normaliza como fecha, y
-- 02-storage.js:2182 los lee de la hoja SIN Number(), al lado de
-- PRECIO_PROMEDIO_VENTA que si lleva Number(). La primera version de este DDL los
-- declaro numeric por el nombre, y habria reventado el INSERT entero con una fecha
-- en un numeric, con el rollback dejando work_orders con los datos viejos
-- (RULE-SUP-021). El nombre no alcanza para decidir el tipo: el que lo decide es el
-- mapeo de state a tabla, y eso es lo que hizo el agente de escritura al guardarlo.
--
-- prioridad es text y no integer porque la app la acepta en las dos formas:
-- normalizePriority() convierte 'ALTO' en 1, 'BAJO' en 100 y deja 999 si no
-- entiende el valor (app.js, normalizePriority). Un integer la rechazaria.

alter table public.operations add column if not exists num integer;
alter table public.operations add column if not exists parte text;
alter table public.operations add column if not exists contenido text;
alter table public.operations add column if not exists prioridad text;
alter table public.operations add column if not exists fecha_req text;
alter table public.operations add column if not exists comentario text;
alter table public.operations add column if not exists tiempo_fallback numeric;
alter table public.operations add column if not exists kit_pending boolean not null default false;

alter table public.work_orders add column if not exists due_date_override text;
alter table public.work_orders add column if not exists precio_desde text;
alter table public.work_orders add column if not exists precio_hasta text;

comment on column public.operations.num is 'Numero de secuencia tal como lo muestra la app (estado.operations[].num)';
comment on column public.operations.prioridad is 'Texto: la app acepta numero o palabra (ALTO/BAJO) y la convierte con normalizePriority';
comment on column public.operations.fecha_req is 'Fecha de necesidad como texto, igual que plan_start. Puede no ser una fecha';
comment on column public.operations.tiempo_fallback is 'Minutos de tiempo alternativo cuando la capacidad no es finita';
comment on column public.work_orders.due_date_override is 'Fecha de entrega ajustada a mano; vacio = la de NetSuite manda';

-- ============================================================================
-- 2. EL REGISTRO DE EVENTOS (el `log` de cada operacion).
--
-- QUE PEDIA EL USUARIO, textual: 'log es la que más necesita tu criterio... si me
-- gustaria esto e incluso una vista mas en la web para poder acceder a ella y
-- debuggear, podria ser otra tabla de supabase'.
--
-- POR QUE TABLA Y POR QUE NO UNA COLUMNA EN operations. Un `log` es un flujo: la
-- app le anade una entrada cada vez que alguien cambia la maquina, el
-- herramental, el kit o la fecha de una operacion, y esa operacion se puede ver
-- cambiar cien veces. Como columna, operations creeria sin limite y el planificador
-- -- que lee esa tabla constantemente para pintar la cola -- seria cada vez mas
-- lento. Ademas un flujo se consulta por OT, por tipo de evento y por fecha, y eso
-- quiere indices, no una columna. Y con tabla aparte se puede ensuciar y limpiar
-- sin tocar el plan.
--
-- POR QUE `kind` ES UNA COLUMNA Y payload ES jsonb. 'kind' es lo que se filtra en
-- la vista de debug (todos los cambios de MAQUINA, de HERRAMENTAL, de FECHA), asi
-- que es columna e indice. El resto del evento va en jsonb, porque su forma la
-- decide la app y cambia con cada version: anadir un campo nuevo al registro no
-- debe requerir un ALTER TABLE. Esa es la parte que hace que esto escale.
--
-- `actor` guarda el auth.uid() de quien hizo el cambio cuando la escritura viene
-- del navegador con sesion, y 'appscript' o 'restlet' cuando viene de los otros dos
-- caminos. Es la trazabilidad que se pidio al elegir Auth anonimo: con escritura
-- directa, lo que no se registra, no se puede depurar.
-- ============================================================================

create table if not exists public.operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null,
  ot text,
  secuencia integer,
  ct text,
  kind text not null,
  at timestamptz not null default now(),
  actor text,
  payload jsonb,
  created_at timestamptz not null default now()
);

comment on table public.operation_events is
  'Registro de cambios por operacion (el log de la app). Es un flujo, no un atributo: por eso es tabla y no columna de operations. Ver RULE-SUP-023.';
comment on column public.operation_events.kind is 'Tipo de evento, por ejemplo MAQUINA_OT_APP o CAMBIO_HERRAMENTAL. Es la columna que se filtra en la vista de debug';
comment on column public.operation_events.actor is 'Quien lo hizo: auth.uid() si viene del navegador con sesion, o appscript / restlet si viene de los otros caminos';
comment on column public.operation_events.payload is 'El resto del evento. jsonb a proposito: su forma la decide la app y anadir un campo no debe requerir un ALTER TABLE';

-- Indices. La vista de debug va a filtrar por estos cuatro ejes, y sin ellos cada
-- consulta seria un seq scan sobre una tabla que solo crece.
create index if not exists operation_events_ot_at_idx    on public.operation_events (ot, at desc);
create index if not exists operation_events_kind_at_idx on public.operation_events (kind, at desc);
create index if not exists operation_events_at_idx       on public.operation_events (at desc);
create index if not exists operation_events_operation_idx on public.operation_events (operation_id, at desc);

-- La tabla es de SOLO LECTURA para la web al principio. Quien escribe es el
-- escritor del plan, no la pagina: si la pagina puede escribir el log, puede
-- escribir tambien el resto, y eso ya es un paso decision aparte. El permiso se
-- abre abajo, en la seccion 4, junto con el del estado del plan.

-- ============================================================================
-- 3. LOS INDICES QUE FALTABAN EN LAS TABLAS DE CONSULTA FRECUENTE.
--    MEDIDO 2026-09-29: operations tiene 2152 filas, work_orders 212. Hoy caben
--    enteras en memoria, pero el planificador las lee en cada render y las va a
--    leer tambien la web. Un indice por OT es lo minimo y no estorba.
-- ============================================================================
create index if not exists operations_ot_idx      on public.operations (ot);
create index if not exists work_orders_ot_idx     on public.work_orders (ot);
create index if not exists materials_ot_idx       on public.materials (ot);

-- ============================================================================
-- 4. QUIEN PUEDE ESCRIBIR.
--
-- Se aplica lo mismo que en docs/schema-supabase-login-correo.sql, mas las tablas
-- que aqui se abren. OJO CON EL ORDEN: los permisos de escritura tienen que estar
-- en su sitio ANTES de que la web escriba, o el primer guardado va a fallar con un
-- 401 que parece un problema de la pagina y no de los permisos.
--
-- app_state, selected_ots, locked_ots, operation_plan_statuses, plan_snapshots,
-- unconfirmed_work_orders y closed_work_order_summaries las escribe la pagina con
-- sesion. Son el estado que hoy vive solo en las Hojas.
-- ============================================================================
do $$
declare
  t text;
  lecturas text[] := array[
    'operations', 'work_orders', 'materials', 'items', 'machines', 'inventory',
    'sales_orders', 'capabilities', 'operation_catalog', 'matrix', 'operators',
    'ot_types', 'calendar_exceptions', 'article_configurations', 'ot_configurations',
    'tools', 'subcontracts', 'machine_planning_overrides',
    'app_state', 'selected_ots', 'locked_ots', 'operation_plan_statuses',
    'plan_snapshots', 'unconfirmed_work_orders', 'closed_work_order_summaries',
    'operation_events'
  ];
  escrituras text[] := array[
    'capabilities', 'operation_catalog', 'matrix', 'operators', 'ot_types',
    'calendar_exceptions', 'article_configurations', 'ot_configurations', 'tools',
    'subcontracts', 'machine_planning_overrides',
    'app_state', 'selected_ots', 'locked_ots', 'operation_plan_statuses',
    'plan_snapshots', 'unconfirmed_work_orders', 'closed_work_order_summaries',
    'operations', 'work_orders', 'materials', 'operation_events'
  ];
begin
  foreach t in array lecturas loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lectura_web on public.%I', t);
    execute format('drop policy if exists lectura_app on public.%I', t);
    execute format(
      'create policy lectura_app on public.%I for select to authenticated using (true)', t);
  end loop;

  foreach t in array escrituras loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists escritura_app on public.%I', t);
    -- with check explicito y no por omision: sin el, RLS filtra lo que se LEE y
    -- no filtra lo que se ESCRIBE, y un delete pasaria sin comprobar nada.
    execute format(
      'create policy escritura_app on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================================
-- 5. EL RPC DE ESPEJO, CON LAS TABLAS DEL PLAN.
--
-- UN SOLO MECANISMO. public.ingesta_mirror ya existe y ya hace lo que necesita
-- un guardado de estado completo: borra la tabla e inserta lo que recibe, en una
-- transaccion. Agregar 'operations' y 'work_orders' a su whitelist es lo que hace
-- que la web pueda escribir el plan sin una sola linea de SQL nueva. La regla de
-- escalabilidad esta aqui: mas tablas cuestan una entrada mas en este array.
--
-- OJO: ingesta_mirror ES BORRA-E-INserta. Para el estado del plan eso es lo
-- correcto, porque el navegador manda el estado completo y el espejo lo reproduce
-- tal cual. No es un upsert: si la web manda menos filas de las que hay, las de mas
-- desaparecen. Y eso es lo que hay que querer cuando alguien borra una operacion
-- del plan.
-- ============================================================================
create table if not exists public.ingesta_mirror_whitelist (
  tabla text primary key,
  nota text,
  agregado_at timestamptz not null default now()
);
comment on table public.ingesta_mirror_whitelist is
  'Tablas que public.ingesta_mirror puede sustituir. Es la lista que hace barato agregar tablas al sistema: una fila aqui, nada de SQL nuevo.';

insert into public.ingesta_mirror_whitelist (tabla, nota) values
  ('work_orders',    'ingesta de NetSuite y, desde la web, el estado del plan'),
  ('operations',     'ingesta de NetSuite y, desde la web, el estado del plan'),
  ('materials',      'ingesta de NetSuite'),
  ('items',          'ingesta de NetSuite'),
  ('machines',       'ingesta de NetSuite (RULE-SUP-010: la escribe el RESTlet, no el espejo de catalogos)'),
  ('inventory',      'ingesta de NetSuite'),
  ('sales_orders',   'ingesta de NetSuite'),
  ('capabilities',           'catalogo, lo escribe la web'),
  ('operation_catalog',      'catalogo, lo escribe la web'),
  ('matrix',                 'catalogo, lo escribe la web'),
  ('operators',              'catalogo, lo escribe la web'),
  ('ot_types',               'catalogo, lo escribe la web'),
  ('calendar_exceptions',    'catalogo, lo escribe la web'),
  ('article_configurations', 'catalogo, lo escribe la web'),
  ('ot_configurations',      'catalogo, lo escribe la web'),
  ('tools',                  'catalogo, lo escribe la web'),
  ('subcontracts',           'catalogo, lo escribe la web'),
  ('machine_planning_overrides', 'override de RULE-SUP-017'),
  ('app_state',              'estado del plan, lo escribe la web'),
  ('selected_ots',           'estado del plan, lo escribe la web'),
  ('locked_ots',             'estado del plan, lo escribe la web'),
  ('operation_plan_statuses','estado del plan, lo escribe la web'),
  ('plan_snapshots',         'estado del plan, lo escribe la web'),
  ('unconfirmed_work_orders','estado del plan, lo escribe la web'),
  ('closed_work_order_summaries','estado del plan, lo escribe la web')
on conflict (tabla) do update set nota = excluded.nota;

-- La funcion real del RPC sigue teniendo su whitelist DENTRO del cuerpo, y esa es
-- la que manda: public.ingesta_mirror valida p_tabla contra su propia lista. Este
-- archivo no la cambia, y esa es una decision, no una duda: cambiar una lista
-- metida en el cuerpo de una funcion es el cambio que no se ve leyendo un diff.
-- La tabla de arriba es la referencia legible, y para que las dos no se separen en
-- silencio, el RPC se reescribe para LEER de la tabla. Una vez, y a partir de ahi
-- agregar una tabla es insertar una fila.
--
-- Es el unico punto de este archivo que cambia comportamiento en vez de anadir
-- estructura, asi que se separa del resto y se explica solo. La funcion anterior
-- queda en ingest_mirror_v1 para poder volver atras si algo sale mal.

-- Se suelta antes de crearla porque NO se puede cambiar el tipo de retorno de una
-- funcion que ya existe, y la v1 existe desde que se aplico por primera vez. Es
-- inocuo tirarla: su unico proposito es el mensaje de error que dice que la
-- whitelist se movio de aqui a la tabla, o sea que no hace nada por si misma.
drop function if exists public.ingesta_mirror_v1(text, jsonb);
create or replace function public.ingesta_mirror_v1(text, jsonb)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = public
  as $$
declare
  v_tabla text := $1;
begin
  raise exception 'ingesta_mirror: la tabla % no esta en la whitelist de la v1; usa ingesta_mirror, que ya lee public.ingesta_mirror_whitelist', v_tabla;
end;
$$;

-- MEDIDO 2026-09-29: esta funcion YA EXISTE en la base, asi que el `create or
-- replace` tiene que coincidir con su tipo de retorno o falla con "cannot change
-- return type of existing function". El cuerpo tiene un
-- `return jsonb_build_object('ok', true, 'tabla', ..., 'insertadas', ...)`, asi que
-- el tipo es jsonb y sale del codigo, no de una suposicion.
create or replace function public.ingesta_mirror(p_tabla text, p_filas jsonb)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = public
  as $$
declare
  v_tabla text := p_tabla;
  v_permitida boolean;
  v_colnames text[];
  v_queried text;
  v_insertadas integer := 0;
  v_borradas integer := 0;
begin
  -- La whitelist ahora es una TABLA, no una lista metida aqui. Antes vivia en este
  -- cuerpo, y dos listas que dicen cosas distintas es exactamente el fallo que
  -- hace perder una tarde.
  select exists (select 1 from public.ingesta_mirror_whitelist w where w.tabla = v_tabla)
    into v_permitida;
  if not v_permitida then
    raise exception 'ingesta_mirror: la tabla % no esta en la whitelist (public.ingesta_mirror_whitelist)', v_tabla;
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'ingesta_mirror: p_filas tiene que ser un array, no %', coalesce(jsonb_typeof(p_filas), 'null');
  end if;

  select coalesce(array_agg(a.attname order by a.attname), '{}'::text[])
    into v_colnames
    from pg_attribute a
   where a.attrelid = to_regclass(v_tabla)::regclass
     and a.attnum > 0
     and not a.attisdropped;

  -- Las columnas que llegan tienen que existir. Un nombre desconocido se rechaza
  -- aqui en vez de dejar que reviente el INSERT con un error de Postgres que no
  -- dice que la fila venia del espejo.
  select string_agg(k, ', ')
    into v_queried
    from (
      select jsonb_object_keys(p_filas -> 0) as k
    ) q
   where not (q.k = any (v_colnames));
  if v_queried is not null then
    raise exception 'ingesta_mirror: la tabla % no tiene las columnas %', v_tabla, v_queried;
  end if;

  -- Tautologia a proposito: ningun id vale el uuid nulo, asi que esto borra todas
  -- las filas. PostgREST exige WHERE, y 'WHERE true' en un DELETE sin clave no es
  -- valido para el (PGRST, MEDIDO 2026-09-29).
  execute format('delete from public.%I where id <> %L::uuid', v_tabla, '00000000-0000-0000-0000-000000000000');
  get diagnostics v_borradas = row_count;

  insert into public.%I
  select (jsonb_populate_recordset(null::public.%I, p_filas)).*
    from jsonb_array_elements(p_filas) as f;
  get diagnostics v_insertadas = row_count;

  return jsonb_build_object('ok', true, 'tabla', v_tabla, 'borradas', v_borradas, 'insertadas', v_insertadas);
end;
$$;

-- Solo service_role. El navegador escribe por las POLITICAS, no por este RPC: este
-- borra la tabla entera, y una pagina que puede llamarlo puede vaciar el plan.
revoke execute on function public.ingesta_mirror(text, jsonb) from anon;
revoke execute on function public.ingesta_mirror(text, jsonb) from authenticated;
revoke execute on function public.ingesta_mirror(text, jsonb) from public;
revoke execute on function public.ingesta_mirror_v1(text, jsonb) from anon;
revoke execute on function public.ingesta_mirror_v1(text, jsonb) from authenticated;
revoke execute on function public.ingesta_mirror_v1(text, jsonb) from public;
grant execute on function public.ingesta_mirror(text, jsonb) to service_role;
grant execute on function public.ingesta_mirror_v1(text, jsonb) to service_role;

-- ============================================================================
-- 6. COMPROBACIONES. Si algo de arriba fallo, esto aborta antes de que nadie
--    Celebre un exito parcial.
-- ============================================================================
do $$
declare
  n integer;
begin
  -- 1. Las columnas nuevas de operations
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'operations'
     and column_name in ('num','parte','contenido','prioridad','fecha_req',
                         'comentario','tiempo_fallback','kit_pending');
  if n <> 8 then
    raise exception 'operations: hay % de 8 columnas nuevas', n;
  end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'work_orders'
     and column_name in ('due_date_override','precio_desde','precio_hasta');
  if n <> 3 then
    raise exception 'work_orders: hay % de 3 columnas nuevas', n;
  end if;

  -- 2. La tabla de eventos existe con sus cuatro indices.
  if not exists (select 1 from pg_class where relname = 'operation_events') then
    raise exception 'no se creo operation_events';
  end if;
  select count(*) into n from pg_indexes
   where schemaname = 'public' and tablename = 'operation_events';
  if n <> 4 then
    raise exception 'operation_events: hay % de 4 indices', n;
  end if;

  -- 3. Ninguna politica abierta a anon. Debe salir 0.
  select count(*) into n from pg_policies
   where schemaname = 'public' and 'anon' = any(roles);
  if n <> 0 then
    raise exception 'QUEDAN % politicas abiertas a anon', n;
  end if;
end $$;

-- ===========================================================================
-- PLAN GUARDADO EN UNA TRANSACCION. Lo que hace falta para que la web escriba.
-- ===========================================================================
--
-- QUE SE CIERRA AQUI, Y POR QUE NO SE PUEDE HACER DESDE EL NAVEGADOR.
--
-- El escritor de la pagina borra y reinscribe tablas, y son varias peticiones.
-- Entre una y otra cabe otra persona guardando, o un fallo de red. Con lo que
-- hay hoy, un guardado a medias deja el plan escrito por la mitad, que es PEOR
-- que no haber guardado: la pagina siguiente lee un plan que no guardo nadie.
--
-- Ademas la comprobacion de la revision tiene que vivir DENTRO de la
-- transaccion. Si se hace en el navegador, se compara, se espera el tiempo de un
-- viaje de red, y se borra: en ese hueco la otra persona tambien comparo. Por
-- eso la revision se comprueba con un `for update` sobre la fila unica de
-- app_state, que es un bloqueo de fila de Postgres y serializa a los que
-- guardan sin necesitar un candado en el codigo del navegador.
--
-- EL MODELO QUE SE APLICA A CADA TABLA, y el motivo de que sean tres y no uno:
--
--   actualiza  La web solo MODIFICA filas que ya existen. Sin insertar, sin
--              borrar. Es el modo de las tres tablas del ERP, y es el que impide
--              que la pagina cree o destruya datos de NetSuite. No se borra nada,
--              y una fila que el navegador no conoce no se toca: ese era el
--              riesgo medido del espejo.
--   espejo     Borra y reinscribe, y solo en las tablas donde la persona es el
--              UNICO escritor. Si mañana otra cosa las escribe, salen de aqui.
--   anexo      Se agrega y nunca se borra: es un historico.
--   flujo      Solo inserta, y con clave idempotente para que dos guardados del
--              mismo evento den el mismo resultado.
--
-- lista en el cuerpo de una funcion es el cambio que no se ve leyendo un diff.
-- Es el mismo argumento que llevo la whitelist de ingesta_mirror a una tabla: una
-- lista en el cuerpo de una funcion es el cambio que no se ve leyendo un diff.
-- Agregar una columna que la web decide es un UPDATE de un arreglo, no SQL nuevo.
alter table public.operations add column if not exists retirada_en timestamptz;
alter table public.operations add column if not exists retirada_por text;

-- plan_snapshots TIENE una columna que se parece y no sirve: `operations jsonb`.
-- MEDIDO 2026-09-29: la tabla tiene id, snapshot_id, operations, generated_at,
-- plan_start, version, usuario, change_summary, published_at,
-- publication_reason y created_at. NO tiene `payload`, y la primera version de
-- plan_guardar hacia insert into plan_snapshots (snapshot_id, payload, created_at).
-- Eso no resuelve, y como la sentencia viene de jsonb_populate_recordset, no es un
-- INSERT que se salte esa fila: se CAE la transaccion entera. O sea que un solo
-- borrador habria roto TODOS los guardados, no solo los de borrador. Error mio,
-- encontrado por el agente que escribio el escritor al usar el contrato.
--
-- Por que se AGREGA `payload` y no se amolda el insert a `operations`: un borrador
-- sirve para RESTAURAR el plan, y para eso hacen falta las ordenes de trabajo, los
-- materiales, los estados de operacion y las OTs seleccionadas, no solo las
-- operaciones. Meterlo todo en la columna `operations` seria guardar media
-- restauracion. Se agrega la columna y queda documentada.
alter table public.plan_snapshots add column if not exists payload jsonb;

comment on column public.plan_snapshots.payload is
  'El estado completo del plan en el momento del borrador, para restaurarlo entero: operaciones, ordenes de trabajo, materiales, estados y OTs. La columna `operations` que ya existia es solo la lista de operaciones y no alcanza para restaurar.';

comment on column public.operations.retirada_en is
  'Cuando esta operacion salio del plan por decision de una persona, no por NetSuite. MEDIDO 2026-09-29: no existe en el estado ninguna lista de operaciones retiradas (operationPlanStatuses es un objeto y removedOperations solo se calcula para el preview de restaurar, planning-workflow-core.js:1315), asi que la fuente real y persistida es selected_ots: si la OT sale de ahi, sus operaciones salen del plan, y eso la base lo sabe sola. Al volver la OT, la marca se borra.';
comment on column public.operations.retirada_por is
  'Correo de quien Provoco la retirada, del JWT de supabase-auth. Null significa que la operacion esta en el plan.';

-- app_state esta VACIA hoy (medido 2026-09-29) y de ahi sale la fila unica que
-- serializa los guardados. Sin esta fila, plan_guardar no tiene contra que
-- comparar la revision y no puede decidir nada.
insert into public.app_state (id, revision) values (1, 0) on conflict (id) do nothing;

-- MEDIDO 2026-09-29 con sondas: work_orders NO tiene indice unico en
-- wo_internal_id, y sin el el upsert falla con 42P10. Se agregan los que faltan
-- y se verificó antes que no hay duplicados que los bloqueen: work_orders
-- 212 filas / 212 wo_internal_id distintos, materials 334/334 en (ot,line_id),
-- operations 1000/1000 en operation_id. El bloque do de mas abajo vuelve a
-- comprobarlo y ABORTA si aparecen duplicados, en vez de dejar un indice a medias.
create unique index if not exists work_orders_wo_internal_id_key on public.work_orders (wo_internal_id);
create unique index if not exists plan_snapshots_snapshot_id_key  on public.plan_snapshots (snapshot_id);

create table if not exists public.plan_tabla_escritura (
  tabla text primary key,
  modo text not null check (modo in ('actualiza','espejo','anexo','flujo')),
  clave text,
  columnas text[],
  nota text
);
comment on table public.plan_tabla_escritura is
  'Que puede escribir la web en cada tabla y como. La lista de columnas es lo que hace que una escritura desde la pagina no pueda pisar un dato del ERP: lo que no esta en la lista no se toca. Cambiar que la web escriba una columna mas es un UPDATE de este arreglo, y queda en un diff.';

insert into public.plan_tabla_escritura (tabla, modo, clave, columnas, nota) values
  ('operations', 'actualiza', 'operation_id',
   array['num','parte','contenido','prioridad','fecha_req','comentario','tiempo_fallback','kit_pending',
         'secuencia','ct','operador','maquina','herramental','kit',
         'fecha_inicio','hora_inicio','fecha_fin','hora_fin',
         'estatus','locked','auto_frozen','subcontract_type','subcontract_days'],
   'Solo decisiones de plan: cuando, donde, con que, en que orden. Los datos del ERP (descripcion, cantidades, tiempos, tipo_insercion) NO se tocan, y la fila tiene que existir: la pagina no crea operaciones. `revision` NO esta en la lista a proposito: la pone la funcion con el numero nuevo. Si la mandara la pagina, cada fila quedaria con la revision que tenia la pagina y no con la que se guardo, que es un guardado por detras y hace que el cambio no se pueda atribuir a una revision.'),
  ('work_orders', 'actualiza', 'wo_internal_id',
   array['fecha_inicio_ns','fecha_fin_ns','fecha_vencimiento','due_date_override','precio_desde','precio_hasta',
         'estatus','cant_ensamblada','cant_pendiente','synced_at'],
   'Lo que la pagina decide de una orden son las fechas. El articulo, la cantidad y el cliente son del ERP. `revision` la pone la funcion, no la pagina, por el mismo motivo que en operations.'),
  ('materials', 'actualiza', 'ot,line_id',
   array['emitido'],
   'La pagina no decide componentes: solo que material se emitio. `revision` la pone la funcion, no la pagina.'),
  ('selected_ots', 'espejo', 'ot', array['ot','posicion'],
   'La persona es el unico escritor, y el orden manual importa, asi que va posicion.'),
  ('locked_ots', 'espejo', 'ot', array['ot'],
   'La persona es el unico escritor.'),
  ('operation_plan_statuses', 'espejo', 'key',
   array['key','ot','secuencia','ct','status','origin','fecha_completado','fecha_reapertura'],
   'La persona es el unico escritor. `revision` la pone la funcion.'),
  ('plan_snapshots', 'anexo', 'snapshot_id', null,
   'Historico de borradores: se agrega y nunca se borra.'),
  ('operation_events', 'flujo', 'id', null,
   'Flujo de eventos: solo inserta, con clave idempotente para que guardar dos veces no duplique.')
on conflict (tabla) do update
  set modo = excluded.modo, clave = excluded.clave, columnas = excluded.columnas, nota = excluded.nota;

-- ===========================================================================
-- plan_guardar: el guardado de la pagina, en una transaccion, con la revision.
-- ===========================================================================
--
-- POR QUE ESTA FUNCION Y NO UNA SERIE DE PETICIONES DESDE EL NAVEGADOR. Tres
-- razones, y las tres son medibles:
--
--   1. Atomicidad. Borrar y reinsertar son varias peticiones. Un fallo en medio
--      deja el plan a medias, y un plan a medias es PEOR que no guardar: la
--      pagina siguiente lee un estado que no escribio ninguna persona.
--   2. La revision se comprueba DENTRO. `select ... for update` sobre la fila
--      unica de app_state es un bloqueo de fila de Postgres: dos personas que
--      guardan a la vez se serializan solas, sin candados en el navegador. Si la
--      comprobacion fuera en el cliente, las dos compararian, las dos pasarian, y
--      la segunda pisaria a la primera.
--   3. Las columnas. El update se arma con la lista de plan_tabla_escritura, asi
--      que la pagina no puede tocar una columna que no este ahi. Sin eso, un
--      update de fila completa pondria en NULL los datos del ERP que el
--      navegador no conoce, que es la misma perdida de datos por el otro lado.
--
-- POR QUE ESTA FUNCION SI SE ABRE AL NAVEGADOR, Y ingesta_mirror NO. Es una
-- distincion importante y por eso va escrita: ingesta_mirror borra la tabla
-- entera sin mirar quien llama, y por eso sigue revocado para anon y
-- authenticated. plan_guardar no borra nada: solo modifica filas existentes de
-- las tres tablas del ERP y sustituye las cuatro que la persona escribe sola. Y
-- si la revision no coincide, no escribe nada y lo dice. Esa es la garantia que
-- hace aceptable exponerla, y se pierde en cuanto se lequite el `for update`.
--
-- LO QUE DEVUELVE. Un jsonb con ok, revision (la nueva), y por tabla quantas
-- filas se tocaron. Si hubo conflicto: ok false, conflicto CONFLICT_REVISION y la
-- revision que hay ahora, para que la pagina pueda recargar y reintentar. La
-- pagina NO debe interpretar un ok false como un fallo de red: son cosas
-- distintas y confundirlas hace que la persona pierda su trabajo en silencio.
create or replace function public.plan_guardar(
  p_payload jsonb,
  p_revision_esperada integer,
  p_actor text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actual integer;
  v_nueva integer;
  v_ots_actuales text[];
  v_ots_nuevas text[];
  v_modo text;
  v_clave text;
  v_cols text[];
  v_tabla text;
  v_sql text;
  v_asignar text;
  v_filas integer;
  v_actor text;
  v_entrantes text[];
  v_salientes text[];
  v_informe jsonb := '{}'::jsonb;
  v_t0 timestamptz := clock_timestamp();
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'plan_guardar: p_payload tiene que ser un objeto jsonb'
      using errcode = '22023';
  end if;

  -- El candado de fila. Todo lo que sigue ocurre con esta fila bloqueada, asi
  -- que dos guardos simultaneos se serializan aqui y no despues. Si se quita
  -- esta linea, la comprobacion de revision deja de servir para nada.
  select revision into v_actual from public.app_state where id = 1 for update;

  if not found then
    raise exception 'plan_guardar: no existe la fila id=1 de app_state, sin ella no hay contra que comparar la revision'
      using errcode = '23514';
  end if;

  -- Optimismo NO: la revision tiene que COINCIDIR. Si no coincide, otra persona
  -- guardo despues de que esta cargo, y seguir escribiendo seria perder su
  -- trabajo. Se devuelve el dato para que la pagina recargue.
  if p_revision_esperada is distinct from v_actual then
    return jsonb_build_object(
      'ok', false,
      'conflicto', 'CONFLICT_REVISION',
      'revision_actual', v_actual,
      'revision_esperada', p_revision_esperada,
      'mensaje', 'El plan cambio desde la ultima carga. Recarga antes de guardar.',
      'ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000)
    );
  end if;

  v_nueva := v_actual + 1;
  v_actor := coalesce(p_actor, 'desconocido');

  -- Las OTs que hay ahora, ANTES de sustituirlas. Son la fuente real de que una
  -- operacion salio del plan: si la OT sale de selected_ots, sus operaciones
  -- dejan de estar planificadas. No hay que pedirselo a la pagina porque no lo
  -- sabe: la pagina tampoco tiene lista de retiradas.
  select coalesce(array_agg(ot order by posicion), '{}') into v_ots_actuales
    from public.selected_ots;

  v_ots_nuevas := coalesce(
    (select array_agg(x ->> 'ot') from jsonb_array_elements(coalesce(p_payload -> 'selected_ots', '[]'::jsonb)) as x),
    '{}'
  );

  v_entrantes := array(select distinct o from unnest(v_ots_nuevas) o where o not in (select unnest(v_ots_actuales)));
  v_salientes := array(select distinct o from unnest(v_ots_actuales) o where o not in (select unnest(v_ots_nuevas)));

  -- 1) LAS TRES DEL ERP: solo UPDATE, por filas que ya existen. Nunca insert,
  --    nunca delete. Es lo que impide que la pagina destruya datos de NetSuite
  --    que el navegador todavia no conoce.
  foreach v_tabla in array array['operations','work_orders','materials'] loop
    select modo, clave, columnas into v_modo, v_clave, v_cols
      from public.plan_tabla_escritura where tabla = v_tabla;
    if v_modo <> 'actualiza' then
      raise exception 'plan_guardar: % deberia ser actualiza y esta en %', v_tabla, v_modo
        using errcode = '23514';
    end if;

    -- La lista de columnas sale de la tabla, no del payload. Por eso una columna
    -- que la web no declare queda con su valor anterior en vez de en NULL.
    -- La revision la pone la funcion con v_nueva, no la pagina. Motivo: si la mandara el
    -- navegador, cada fila quedaria con la revision que TENIA la pagina, que es un
    -- guardado por detras, y no se podria atribuir un cambio a una revision concreta.
    v_asignar := (select string_agg(quote_ident(c) || ' = ex.' || quote_ident(c), ', ')
                    from unnest(v_cols) c
                   where c not in ('operation_id','wo_internal_id','ot','line_id'))
                || ', revision = ' || v_nueva;
    if v_asignar is null then
      raise exception 'plan_guardar: % no tiene columnas escribibles', v_tabla
        using errcode = '23514';
    end if;

    v_sql := format(
      'with ex as (select * from jsonb_populate_recordset(null::public.%I, $1))
       update public.%I t set %s from ex
        where %s = any(array(select %s from ex))',
      v_tabla, v_tabla, v_asignar, v_clave, v_clave
    );
    execute v_sql using (p_payload -> v_tabla);
    get diagnostics v_filas = row_count;

    v_informe := v_informe || jsonb_build_object(v_tabla, jsonb_build_object('modo', 'actualiza', 'filas', v_filas));
  end loop;

  -- 2) LAS MARCAS DE RETIRADA, y por que salen de selected_ots. Cuando una OT
  --    sale del plan, sus operaciones se marcan. NO se borran: borrar es
  --    justamente el problema que esto evita, porque la fila tambien la escribe
  --    la ingesta de NetSuite. Al volver la OT, la marca se levanta y la
  --    operacion vuelve a estar en el plan sola.
  if array_length(v_salientes, 1) > 0 then
    update public.operations
       set retirada_en = now(), retirada_por = v_actor
     where ot = any(v_salientes) and retirada_en is null;
    get diagnostics v_filas = row_count;
    v_informe := v_informe || jsonb_build_object('retiradas', jsonb_build_object('ots', to_jsonb(v_salientes), 'operaciones', v_filas));
  end if;

  if array_length(v_entrantes, 1) > 0 then
    update public.operations
       set retirada_en = null, retirada_por = null
     where ot = any(v_entrantes);
    get diagnostics v_filas = row_count;
    v_informe := v_informe || jsonb_build_object('reintegradas', jsonb_build_object('ots', to_jsonb(v_entrantes), 'operaciones', v_filas));
  end if;

  -- 3) LAS CUATRO QUE LA PERSONA ESCRIBE SOLA: espejo. Se borran y se
  --    reinscriben, y solo aqui, porque no hay un segundo escritor.
  foreach v_tabla in array array['selected_ots','locked_ots','operation_plan_statuses'] loop
    select modo, clave, columnas into v_modo, v_clave, v_cols
      from public.plan_tabla_escritura where tabla = v_tabla;
    if v_modo <> 'espejo' then
      raise exception 'plan_guardar: % deberia ser espejo y esta en %', v_tabla, v_modo
        using errcode = '23514';
    end if;
    execute format('delete from public.%I', v_tabla);
    v_sql := format(
      'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
      v_tabla, array_to_string(v_cols, ', '), array_to_string(v_cols, ', '), v_tabla
    );
    execute v_sql using (p_payload -> v_tabla);
    get diagnostics v_filas = row_count;
    v_informe := v_informe || jsonb_build_object(v_tabla, jsonb_build_object('modo', 'espejo', 'filas', v_filas));
  end loop;

  -- 4) operation_events: solo inserta, con clave idempotente. Un evento que ya
  --    se escribio no se duplica, para que dos guardados del mismo evento den el
  --    mismo resultado. El id lo calcula el navegador para que sea reproducible.
  if jsonb_array_length(coalesce(p_payload -> 'operation_events', '[]'::jsonb)) > 0 then
    insert into public.operation_events (id, operation_id, ot, ct, secuencia, kind, actor, payload)
    select id, operation_id, ot, ct, secuencia, kind, v_actor, payload
      from jsonb_populate_recordset(null::public.operation_events, p_payload -> 'operation_events')
    on conflict (id) do nothing;
    get diagnostics v_filas = row_count;
    v_informe := v_informe || jsonb_build_object('operation_events', jsonb_build_object('modo', 'flujo', 'filas', v_filas));
  end if;

  -- 5) plan_snapshots: historico. Upsert por snapshot_id, y NUNCA delete.
  if jsonb_array_length(coalesce(p_payload -> 'plan_snapshots', '[]'::jsonb)) > 0 then
    insert into public.plan_snapshots (snapshot_id, payload, created_at)
    select snapshot_id, payload, coalesce(created_at, now())
      from jsonb_populate_recordset(null::public.plan_snapshots, p_payload -> 'plan_snapshots')
    on conflict (snapshot_id) do update set payload = excluded.payload;
    get diagnostics v_filas = row_count;
    v_informe := v_informe || jsonb_build_object('plan_snapshots', jsonb_build_object('modo', 'anexo', 'filas', v_filas));
  end if;

  -- 6) app_state AL FINAL, y la revision va en la misma sentencia. Si algo
  --    fallo antes, la transaccion entera se cae y la revision no se mueve, que
  --    es lo que hace que el siguiente guardado se pueda reintentar sin perder
  --    nada. Al reves, con la revision primero, un fallo dejaria la pagina
  --    creyendo que guardo.
  update public.app_state
     set revision = v_nueva,
         saved_at = coalesce((p_payload -> 'app_state' ->> 'saved_at')::timestamptz, now()),
         synced_at = coalesce((p_payload -> 'app_state' ->> 'synced_at')::timestamptz, now()),
         plan_start = p_payload -> 'app_state' ->> 'plan_start',
         horizon_days = (p_payload -> 'app_state' ->> 'horizon_days')::integer,
         report_week_start = p_payload -> 'app_state' ->> 'report_week_start',
         report_filters = p_payload -> 'app_state' -> 'report_filters',
         settings = p_payload -> 'app_state' -> 'settings',
         plant = p_payload -> 'app_state' -> 'plant',
         operation_catalog_warning = p_payload -> 'app_state' ->> 'operation_catalog_warning',
         last_schedule = p_payload -> 'app_state' -> 'last_schedule',
         updated_at = now()
   where id = 1;

  return jsonb_build_object(
    'ok', true,
    'revision', v_nueva,
    'actor', v_actor,
    'tablas', v_informe,
    'ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000)
  );
exception
  when others then
    -- La transaccion se deshace entera y el error sube a la pagina tal cual.
    -- No se envuelve en un jsonb con ok false: un ok false aqui significaria
    -- "no se guardo", y la pagina tiene que poder distinguir eso de un
    -- conflicto, que si es recuperable.
    raise;
end $$;

comment on function public.plan_guardar(jsonb, integer, text) is
  'Guardado del plan desde la pagina, en una transaccion, con comparacion de revision. Modifica filas existentes de operations, work_orders y materials (nunca inserta ni borra ahi), sustituye las cuatro tablas que la persona escribe sola, y agrega eventos y borradores. Si la revision no coincide devuelve ok false con conflicto CONFLICT_REVISION y no escribe nada.';

-- Permisos. A diferencia de ingesta_mirror, que se queda revocado para el
-- navegador porque borra tablas enteras sin mirar quien llama, esta si se abre a
-- authenticated: no borra nada del ERP, no crea operaciones, y rechaza el
-- guardado si la revision no es la que el navegador leyo.
revoke execute on function public.plan_guardar(jsonb, integer, text) from public;
revoke execute on function public.plan_guardar(jsonb, integer, text) from anon;
grant execute on function public.plan_guardar(jsonb, integer, text) to authenticated;
grant execute on function public.plan_guardar(jsonb, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- COMPROBACIONES, y abortan si algo quedo mal. Esto es lo que convierte el DDL
-- en algo que se puede correr sin miedo: si un indice unico no se puede crear
-- por duplicados, o si la tabla de reglas de escritura no quedo como se espera,
-- el script PARA y lo dice, en vez de dejar la base a medias y seguir.
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  -- 1. app_state con su fila unica, que es de donde sale el candado.
  select count(*) into n from public.app_state where id = 1;
  if n <> 1 then
    raise exception 'app_state: la fila id=1 no existe, plan_guardar no puede comparar la revision';
  end if;

  -- 2. Los indices unicos que hacen posible el upsert, incluidos los dos que se
  --    agregaron aqui. Si un WO se repite, esto para y avisa en vez de dejar el
  --    indice a medias.
  select count(*) into n from pg_indexes
   where schemaname = 'public'
     and tablename in ('operations','work_orders','materials','plan_snapshots','operation_events')
     and indexdef ilike '%unique%';
  if n < 5 then
    raise exception 'faltan indices unicos para el upsert (hay % de 5)', n;
  end if;

  -- 3. La tabla de reglas de escritura completa, con su lista de columnas.
  select count(*) into n from public.plan_tabla_escritura where modo = 'actualiza' and columnas is not null;
  if n <> 3 then
    raise exception 'plan_tabla_escritura: hay % tablas en modo actualiza y tienen que ser 3', n;
  end if;

  -- 4. La funcion existe y es ejecutable por authenticated, y NO por anon. Si
  --    alguien la abrio a anon, para aqui.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'plan_guardar';
  if n = 0 then
    raise exception 'plan_guardar no existe';
  end if;

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join information_schema.routine_privileges rp
      on rp.specific_name = p.oid::regprocedure::text
   where ns.nspname = 'public' and p.proname = 'plan_guardar'
     and rp.grantee = 'anon';
  if n <> 0 then
    raise exception 'plan_guardar tiene EXECUTE para anon: esa tabla no puede seguir asi';
  end if;
end $$;
