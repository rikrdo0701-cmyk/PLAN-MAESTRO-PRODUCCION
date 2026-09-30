-- =============================================================================
-- CIERRE DE CATALOGOS — lo que le falta a Supabase para poder ser la fuente
-- MEDIDO el 2026-09-29 contra el esquema REAL desplegado (no contra el DDL
-- objetivo) y contra los encabezados reales de las hojas (PP_SHEETS,
-- src/server/02-storage.js:1-34).
--
-- POR QUE ESTE ARCHIVO. El proyecto quedo con la decision de que Supabase es el
-- almacen de lectura Y escritura (la web lee por PostgREST con la clave
-- publicable; Apps Script escribe con la service role key, que salta RLS).
-- PERO el esquema desplegado NO puede representar todo lo que las hojas guardan:
-- al sembrar los catalogos el 2026-09-28 se perdieron columnas. Medido:
--
--   hoja OPERADORES      OPERADOR, NOMBRE        -> operators.nombre = OPERADOR
--                                                 (muestra: 'CORTADOR INICIAL')
--                                                 NOMBRE (el nombre real) NO EXISTE
--   hoja CAPACIDADES     SOLAPAMIENTO es RATIO   -> capabilities.solapamiento es
--                                                 BOOLEAN. Se perdio el factor.
--                          PALABRAS_CLAVE         -> no existe columna
--                          CUSTOM                 -> no existe columna
--   hoja HERRAMENTALES   ID                      -> tools.id es uuid; el ID de la
--                                                 hoja NO EXISTE
--   hoja SUBCONTRATOS    ID                      -> subcontracts.id es uuid; igual
--   hoja CALENDARIO      FECHA_INICIO/HORA_INICIO
--                         /FECHA_FIN/HORA_FIN    -> calendar_exceptions.fecha es UN
--                                                 solo dia: 3 columnas perdidas
--   hoja CONFIGURACION_ARTICULO PRECIO_REF_VENTA -> no existe columna (RULE-REP-021)
--
-- Que la columna este en la tabla y que la app la lea es otra cosa: PP_buildState_
-- lee capabilities.SOLAPAMIENTO con Number(... || 1) (02-storage.js:484), o sea
-- RATIO con default 1, y la UI lo edita como porcentaje (app.js:5067 y 5114:
-- percent/100). Un booleano ahi no es un detalle de tipo: es un factor de
-- planificacion perdido.
--
-- COMO SE APLICA. Requiere SUPABASE_DB_PASSWORD. La contrasena NO se teclea en la
-- linea de comando: psReadLine guarda historial de todo lo que se escribe y ahi
-- se quedaria en texto plano. El envoltorio la pide en un prompt oculto, la pasa
-- solo por la memoria del proceso hijo y la borra al terminar:
--
--   powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1
--
-- (equivale a poner SUPABASE_DB_PASSWORD en el entorno y correr
-- scripts/apply-sql-supabase.mjs con este archivo, que sigue siendo la via si ya
-- tenes la variable en el entorno.)
--
-- Es IDEMPOTENTE: todo es add column if not exists / create index if not exists,
-- y la conversion de solapamiento fija 1 (el default documentado de la hoja).
-- NO se inventa ningun valor: los ratios true los pondra el siguiente espejo de
-- catalogos desde las Hojas, que reescribe la tabla completa.
--
-- No lleva begin/commit: scripts/apply-sql-supabase.mjs ya envuelve el archivo en
-- una transaccion, y anidar un BEGIN dentro daria solo un warning.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. operators: el NOMBRE real de la persona (la hoja tiene OPERADOR y NOMBRE)
-- -----------------------------------------------------------------------------
alter table public.operators
  add column if not exists nombre_real text not null default '';

comment on column public.operators.nombre is
  'OPERADOR: la clave con la que se programa (unico).';
comment on column public.operators.nombre_real is
  'NOMBRE: el nombre real de la persona. La hoja OPERADORES tiene las dos columnas; sin esta, el nombre real se perdia al sembrar.';

-- -----------------------------------------------------------------------------
-- 2. capabilities: el factor de solapamiento, las palabras clave y el flag custom
-- -----------------------------------------------------------------------------
-- 2.1 SOLAPAMIENTO: boolean -> numeric (ratio 0..1, default 1).
--     El USING fija 1 en las filas que ya existen porque el boolean sembrado no
--     permite saber el factor original: no se adivina. El siguiente espejo de
--     catalogos sobrescribe la tabla entera con el valor real de la hoja.
--
--     MEDIDO 2026-09-29 (intento 1, rollback): el ALTER ... TYPE falla con
--     'default for column "solapamiento" cannot be cast automatically to type
--     numeric'. Al cambiar el tipo, Postgres castea TAMBIÉN la expresión del
--     DEFAULT, y el default sembrado era boolean, que no tiene conversion
--     automatica a numeric. Por eso el ORDEN importa: primero se quita el
--     default, despues se cambia el tipo, y al final se vuelve a poner ya en
--     numeric. Con las tres en el orden correcto el archivo es idempotente.
alter table public.capabilities
  alter column solapamiento drop default;
alter table public.capabilities
  alter column solapamiento type numeric using (1::numeric);
alter table public.capabilities
  alter column solapamiento set default 1;
alter table public.capabilities
  alter column solapamiento set not null;

comment on column public.capabilities.solapamiento is
  'RATIO de solapamiento 0..1 (la hoja lo edita como porcentaje y lo divide entre 100; default 1). MEDIDO 2026-09-29: venia boolean y se perdia el factor.';

-- 2.2 PALABRAS_CLAVE: texto separado por comas (lo consume state.operationRules.keywords).
alter table public.capabilities
  add column if not exists palabras_clave text not null default '';

-- 2.3 CUSTOM: marca de capacidad creada a mano (state.customCapabilities).
alter table public.capabilities
  add column if not exists custom boolean not null default false;

-- -----------------------------------------------------------------------------
-- 3. tools / subcontracts: el ID textual de la hoja (hoy solo hay uuid)
-- -----------------------------------------------------------------------------
-- El id uuid lo genera la base; el codigo es el identificador de la hoja, que es
-- el que usan las referencias del plan. Se indexa solo cuando viene informado
-- (las filas sembradas antes de esta migracion lo traian vacio).
alter table public.tools
  add column if not exists codigo text not null default '';

alter table public.subcontracts
  add column if not exists codigo text not null default '';

-- MEDIDO 2026-09-30 en la pagina real, guardando los catalogos: 4 tablas con HTTP 400
--   {"code":"42P01","message":"there is no unique or exclusion constraint matching
--    the ON CONFLICT specification"}
-- La primera era tools. Y la causa es el `where codigo <> ''` de los indices de mas abajo:
-- un indice UNICO PARCIAL no lo puede inferir ON CONFLICT (columna). PostgreSQL solo
-- infiere un indice sin predicado, o uno cuyo predicado se escriba EXACTAMENTE igual en la
-- clausula, y PostgREST manda `on_conflict=codigo`, que no lleva predicado. O sea que el
-- indice existia, se llamaba tools_codigo_uniq, y aun asi el INSERT con on_conflict fallaba.
--
-- POR QUE NO SE ARREGLA PONIENDO EL PREDICADO EN EL ESCRITOR. Se podria, con un
-- `merge-duplicates` y una columna expression, pero eso obliga a que la columna del ON
-- CONFLICT sea la expresion (`on coalesce(codigo,'')`) en vez del nombre, y entonces cada
-- catalogo que se lea y se vuelva a mandar tiene que expresarse igual. Un indice unico
-- COMPLETO es mas simple de razonar y es lo que la base puede usar sola.
--
-- POR QUE SE PUEDE HACER COMPLETO. El predicado existia porque las filas sembradas antes
-- traian `codigo` vacio, y varias vacias rompen un indice unico. El escritor NUNCA manda
-- `codigo` vacio (filtra `Boolean(fila.codigo)`), asi que de ahora en adelante no puede
-- haber duplicados de verdad. Las filas viejas se numeran para que el indice se pueda
-- crear, y eso es una decision medida, no un dato inventado: se prefijan con
-- 'LEGADO-' + el id, que es unico por construccion, y el siguiente espejo de catalogos
-- reescribe la tabla entera con el codigo real de la hoja.
update public.tools
   set codigo = 'LEGADO-' || id::text
 where codigo is null or btrim(codigo) = '';

update public.subcontracts
   set codigo = 'LEGADO-' || id::text
 where codigo is null or btrim(codigo) = '';

-- EL DROP DE ABAJO NO ES OPCIONAL, Y ES LO QUE HACE QUE ESTA SECCION SIRVA DE ALGO.
-- Los indices tools_codigo_uniq y subcontracts_codigo_uniq YA EXISTEN en la base: los creo
-- la seccion 3 de este mismo archivo, como PARCIALES (con where codigo <> ''). Y un
-- 'create unique index if not exists' sobre un nombre que ya existe NO HACE NADA: no
-- reemplaza el indice, no lo convierte en completo, se va en silencio. Sin el drop, aplicar
-- este archivo otra vez no arreglaria nada y el 42P01 seguiria igual, con el schema del repo
-- diciendo una cosa y la base teniendo otra. Un DDL que parece arreglado y no lo esta es peor
-- que uno que no existe, porque el que existe da por hecho que se aplico.
drop index if exists public.tools_codigo_uniq;
drop index if exists public.subcontracts_codigo_uniq;

create unique index tools_codigo_uniq
  on public.tools (codigo);

create unique index subcontracts_codigo_uniq
  on public.subcontracts (codigo);

-- -----------------------------------------------------------------------------
-- 3.b calendar_exceptions y ot_configurations: la clave que el escritor YA mandaba
-- -----------------------------------------------------------------------------
-- MEDIDO 2026-09-30, mismo lote: calendar_exceptions y ot_configurations tambien salieron
-- con 42P01, y aqui la causa es mas simple: NO HABIA indice unico. El escritor manda
-- on_conflict=fecha_inicio,concepto,maquina y on_conflict=ot desde antes, y en el
-- schema no habia nada que los respaldara. Sin una restriccion unica, un guardado de
-- catalogos NO es idempotente: cada guardado insertaria otra fila y la tabla creeria
-- sin que nadie lo pidiera.
--
-- NULLS: en PostgreSQL un indice unico NO considera nulos iguales (NULL != NULL), asi que
-- un `maquina` vacio o nuloaria la unicidad. Por eso la columna se normaliza a '' al
-- escribir y el indice es sobre la columna, no sobre la expresion. El escritor ya manda
-- concepto como texto ("" si no hay) y maquina como texto; el '' de esta pieza es la red
-- para lo que venga de otro escritor.
--
-- ESTAS TABLAS NO SE BORRAN al guardar: son ANEXO, no espejo (ver el bloque de
-- guardarCatalogos). Por eso la clave natural tiene que ser de verdad unica: es lo unico
-- que impide que un guardado repetido duplique filas.
create unique index if not exists calendar_exceptions_clave_uniq
  on public.calendar_exceptions (fecha_inicio, concepto, maquina);

create unique index if not exists ot_configurations_ot_uniq
  on public.ot_configurations (ot);

-- 3.c article_configurations y machine_planning_overrides.
-- MEDIDO 2026-09-30: estas dos NO salieron en el 42P01 de produccion, pero al escribir el
-- test que amarra el on_conflict del escritor con los indices del DDL aparecieron: el
-- escritor manda on_conflict=articulo y on_conflict=machine_nombre desde antes, y en el
-- schema del repo no habia indice declarado para ninguna de las dos. O la base real los tiene
-- y el repo no lo sabe, o no los tiene y solo se salvan porque no hay filas que mandar.
-- Ninguna de las dos se puede dar por buena sin mirarla.
-- Son idempotentes: si el indice ya existe con otro nombre queda un segundo unico sobre las
-- mismas columnas, que es inocuo. Si HUBIERA filas duplicadas el create falla y lo dice, que
-- es lo que hace falta. La limpieza de duplicados NO se automatiza a proposito: borraria filas
-- sin que nadie lo pidiera, que es el PELIGRO MEDIDO que ya se sufrio con ingesta_mirror.
create unique index if not exists article_configurations_articulo_uniq
  on public.article_configurations (articulo);

create unique index if not exists machine_planning_overrides_machine_uniq
  on public.machine_planning_overrides (machine_nombre);

comment on column public.tools.codigo is
  'ID de la hoja HERRAMENTALES. Distinto de id (uuid interno).';
comment on column public.subcontracts.codigo is
  'ID de la hoja SUBCONTRATOS. Distinto de id (uuid interno).';

-- -----------------------------------------------------------------------------
-- 4. article_configurations: el precio de referencia de venta (RULE-REP-021)
-- -----------------------------------------------------------------------------
-- PRECIO_MANUAL lo escribe una persona; PRECIO_REF_VENTA lo baja el sync con el
-- precio de venta de NetSuite. Sin esta columna, el precio de venta del reporte
-- se pierde al sembrar.
alter table public.article_configurations
  add column if not exists precio_ref_venta numeric not null default 0;

comment on column public.article_configurations.precio_ref_venta is
  'PRECIO_REF_VENTA: lo baja el sync con el precio de venta de NetSuite (RULE-REP-021). Distinto de precio_manual, que escribe una persona.';

-- -----------------------------------------------------------------------------
-- 5. calendar_exceptions: la ventana completa, no un solo dia
-- -----------------------------------------------------------------------------
-- La hoja CALENDARIO tiene ID, CONCEPTO, MAQUINA, FECHA_INICIO, HORA_INICIO,
-- FECHA_FIN, HORA_FIN, MOTIVO, ACTIVO. La tabla solo traia 'fecha' (un dia), que
-- ademas es NOT NULL y forma parte del unique (fecha, concepto, maquina).
-- Se conservan 'fecha' y ese unique (miles de lectores pueden depender de la
-- forma) y se agregan las tres columnas que faltaban. El escritor de catalogos
-- pondra fecha = coalesce(fecha_inicio, fecha).
alter table public.calendar_exceptions
  add column if not exists fecha_inicio date,
  add column if not exists hora_inicio text not null default '',
  add column if not exists fecha_fin date,
  add column if not exists hora_fin text not null default '';

comment on column public.calendar_exceptions.fecha is
  'Dia de inicio de la excepcion. Se mantiene por el unique (fecha, concepto, maquina); el escritor de catalogos la iguala a coalesce(fecha_inicio, fecha).';
comment on column public.calendar_exceptions.hora_inicio is
  'HORA_INICIO de la hoja CALENDARIO (texto, tal como lo guarda la hoja).';
comment on column public.calendar_exceptions.fecha_fin is
  'FECHA_FIN de la hoja CALENDARIO. Sin esta, una excepcion de varios dias se perdia.';
comment on column public.calendar_exceptions.hora_fin is
  'HORA_FIN de la hoja CALENDARIO (texto, tal como lo guarda la hoja).';

-- -----------------------------------------------------------------------------
-- 6. machine_planning_overrides: la planificacion puede apartar una maquina
-- -----------------------------------------------------------------------------
-- DECISION DEL USUARIO 2026-09-29: "si, la planificacion puede apartar una
-- maquina que NetSuite da por activa". RULE-SUP-017.
--
-- POR QUE UNA TABLA APARTE Y NO UNA COLUMNA EN `machines`. `machines` la escribe
-- el RESTlet 2246 con public.ingesta_mirror, que BORRA la tabla entera e inserta
-- lo que devuelve NetSuite. Cualquier columna que la app escribiera ahi se
-- perderia en la siguiente corrida (cada 15 minutos). Poner el override aqui es
-- lo que hace falta para que no se pierda, y ademas deja un solo escritor por
-- tabla: `machines` = NetSuite, esta = Apps Script.
--
-- QUE ES Y QUE NO ES. Es SOLO lo que la planificacion puede hacer por su cuenta:
-- APARTAR una maquina. La direccion contraria (usar una maquina que NetSuite da
-- por inactiva) NO esta autorizada y por eso no hay columna para forzarla:
-- inventar esa regla seria inventar un permiso que nadie concedio.
--
-- COMO SE LEE. La maquina es utilizable si NetSuite la da activa Y nadie la
-- aparto:  activa_efectiva = machines.activa AND NOT excluida.  El `false` de
-- `excluida` significa "usala", y ausencia de fila tambien significa "usala":
-- por eso la columna es NOT NULL DEFAULT false y el espejo escribe la fila de
-- TODAS las maquinas, no solo las excluidas, para que no haya dos formas de
-- decir lo mismo.
create table if not exists public.machine_planning_overrides (
  id              uuid primary key default gen_random_uuid(),
  machine_nombre  text not null unique,        -- machines.nombre / hoja MAQUINAS.ID
  excluida        boolean not null default false,
  actualizado     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table public.machine_planning_overrides is
  'Maquinas que la PLANIFICACION aparta. Decision del usuario 2026-09-29: la planificacion puede apartar una maquina que NetSuite da por activa. Tabla aparte a proposito: `machines` la reescribe por completo el RESTlet 2246 cada 15 minutos y se llevaria cualquier columna de la app. Solo se autoriza APARTAR, no forzar el uso de una maquina inactiva en NetSuite.';
comment on column public.machine_planning_overrides.machine_nombre is
  'Nombre de la maquina, el mismo texto que machines.nombre y que la hoja MAQUINAS guarda en ID. Se compara normalizado (trim + upper) porque el state normaliza a mayusculas.';

-- RLS: igual que las demas, SOLO lectura para anon. Quien escribe es Apps Script con la
-- service role key, que se salta RLS. A `anon` no se le da escritura ni aqui ni en
-- ninguna otra tabla (RULE-SUP-015): la clave publicable va en el bundle publico de Pages.
alter table public.machine_planning_overrides enable row level security;
drop policy if exists lectura_web on public.machine_planning_overrides;
create policy "lectura_web" on public.machine_planning_overrides for select to anon using (true);

-- -----------------------------------------------------------------------------
-- 7. El espejo: admision de las tablas de catalogo en la whitelist de ingesta_mirror
-- -----------------------------------------------------------------------------
-- El RPC es SECURITY INVOKER y solo service_role puede ejecutarlo (revoke de
-- PUBLIC al final), asi que ampliar la whitelist NO abre escritura a anon: el
-- rol que escribe sigue siendo el Apps Script. La razon de la whitelist es que
-- p_tabla no pueda apuntar a cualquier tabla, no que los catalogos queden fuera.
create or replace function public.ingesta_mirror(
  p_tabla text,
  p_filas jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tabla       regclass;
  v_cols        text[];
  v_cols_i      text;
  v_cols_r      text;
  v_desconoc    text[];
  v_borradas    bigint;
  v_insertadas  int;
  v_sql         text;
begin
  -- Whitelist: las 7 tablas de la ingesta de NetSuite MAS las de catalogos que
  -- espeja el escritor src/server/16-supabase-catalogo.js. Sigue sin incluir
  -- app_state, selected_ots, locked_ots, operation_plan_statuses ni
  -- plan_snapshots: esas son escritura de la app (fase 4) y no se espejan.
  -- machine_planning_overrides entra: la escribe Apps Script (la app es quien
  -- aparta maquinas) y el RESTlet NUNCA la toca, asi que no hay dos escritores.
  if p_tabla not in ('work_orders','operations','materials','items','machines',
                     'inventory','sales_orders',
                     'operators','capabilities','operation_catalog','matrix',
                     'tools','subcontracts','ot_types','calendar_exceptions',
                     'ot_configurations','article_configurations',
                     'machine_planning_overrides') then
    raise exception 'ingesta_mirror: tabla no permitida: %', p_tabla;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'ingesta_mirror: p_filas debe ser un arreglo jsonb';
  end if;
  v_tabla := format('public.%I', p_tabla)::regclass;

  execute format('delete from %s where id <> ''00000000-0000-0000-0000-000000000000''', v_tabla);
  get diagnostics v_borradas = row_count;

  if jsonb_array_length(p_filas) > 0 then
    select array_agg(c) into v_cols
      from jsonb_object_keys(p_filas -> 0) as c;

    select array_agg(c) into v_desconoc
      from unnest(v_cols) as c
     where c not in ('id','created_at','updated_at')
       and not exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = p_tabla
               and column_name = c);
    if v_desconoc is not null then
      raise exception 'ingesta_mirror: columnas no existen en %.%: %',
        'public', p_tabla, array_to_string(v_desconoc, ', ');
    end if;

    select array_agg(c) into v_cols
      from unnest(v_cols) as c
     where c not in ('id','created_at','updated_at');

    select string_agg(format('"%s"', c), ','),
           string_agg(format('r."%s"', c), ',')
      into v_cols_i, v_cols_r
      from unnest(v_cols) as c;

    if v_cols_i is null then
      raise exception 'ingesta_mirror: payload sin columnas insertables';
    end if;

    v_sql := format(
      'insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1) as r',
      v_tabla, v_cols_i, v_cols_r, v_tabla);
    execute v_sql using p_filas;
    get diagnostics v_insertadas = row_count;
  else
    v_insertadas := 0;
  end if;

  return jsonb_build_object('ok', true, 'tabla', p_tabla,
                            'borradas', v_borradas, 'insertadas', v_insertadas);
end
$$;

revoke all on function public.ingesta_mirror(text, jsonb) from public;
grant execute on function public.ingesta_mirror(text, jsonb) to service_role;
