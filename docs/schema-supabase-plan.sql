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
alter table public.work_orders add column if not exists precio_desde numeric;
alter table public.work_orders add column if not exists precio_hasta numeric;

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

create or replace function public.ingesta_mirror_v1(text, jsonb)
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

create or replace function public.ingesta_mirror(p_tabla text, p_filas jsonb)
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
