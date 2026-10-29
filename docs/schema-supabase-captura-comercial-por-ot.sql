-- RULE-OT-057 — PERSISTENCIA DE LA CAPTURA COMERCIAL POR OT Y DE LA FIRMA DE PREPARACION
--
-- CAUSA RAIZ que cierra (medida 2026-10-10): RULE-OT-056 guarda la captura comercial POR OT
-- en state.otConfigurations[ot].{jobType,planningType,manualUnitPrice,commercialCapturedAt}
-- y la firma de "ya preparado" en state.preparedPlanningByOt[ot], pero el esquema de Supabase
-- no podia representarlas:
--   * ot_configurations no tenia tipo_ot, tipo_trabajo, precio_manual ni la marca de captura.
--   * app_state no tenia prepared_planning_by_ot.
-- El escritor no las mandaba y el lector no las leia, asi que en cada guardado/carga se perdian.
-- Consecuencia: commercialCapturedAt siempre vacio -> commercialPlanningRequirement marcaba
-- needsManualPrice/needsType/needsPlanningType -> "Generar plan" volvia a abrir el dialogo de
-- detalles de OT. Medido en produccion: 115 OTs en cola, 0 con captura, 18 re-pediendo.
--
-- Esta migracion es ADITIVA (add column if not exists) y re-crea plan_guardar con UNA linea
-- mas para que la funcion escriba la columna nueva de app_state. create or replace conserva los
-- permisos (grants) que ya tenia la funcion.
--
-- ORDEN: aplicar este DDL ANTES de desplegar el codigo que escribe/lee las columnas nuevas.

-- 1) Captura comercial POR OT en ot_configurations.
alter table public.ot_configurations
  add column if not exists tipo_ot text not null default '',
  add column if not exists tipo_trabajo text not null default '',
  add column if not exists precio_manual numeric not null default 0,
  add column if not exists comercial_capturado_en timestamptz;

-- 2) Firma de preparacion por OT en app_state.
alter table public.app_state
  add column if not exists prepared_planning_by_ot jsonb not null default '{}'::jsonb;

-- 3) plan_guardar: escribir la columna nueva de app_state.
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
  v_escribibles text;
  v_claves text[];
  v_izq text;
  v_der text;
  v_where text;
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
    --
    -- El agregado se mira ANTES de pegarle ', revision = ...'. Si se concatenara primero,
    -- un NULL de string_agg se comeria la concatenacion y v_asignar valdria
    -- ', revision = 3': no es null, el `if v_asignar is null` de abajo no se dispara nunca, y
    -- lo que sale es un error de sintaxis de Postgres que no dice que le pasa a la regla.
    v_escribibles := (select string_agg(quote_ident(c) || ' = ex.' || quote_ident(c), ', ')
                        from unnest(v_cols) c
                       where c not in ('operation_id','wo_internal_id','ot','line_id'));
    if v_escribibles is null then
      raise exception 'plan_guardar: % no tiene columnas escribibles', v_tabla
        using errcode = '23514';
    end if;
    v_asignar := v_escribibles || ', revision = ' || v_nueva;

    -- MEDIDO 2026-09-30: LA SENTENCIA DE ARRIBA, TAL COMO ESTABA, NO SE PODIA EJECUTAR.
    -- Era `where %s = any(array(select %s from ex))`, con la columna de la clave SIN
    -- calificar en el lado de la tabla. `ex` sale de jsonb_populate_recordset de la MISMA
    -- tabla, asi que trae todas sus columnas: en operations, `operation_id` existe en `t` y en
    -- `ex`, y Postgres contesta 42702 `column reference "operation_id" is ambiguous`. Como el
    -- ciclo empieza por operations, la funcion se caia en la primera tabla, con la
    -- transaccion sin escribir NADA. Medido en el navegador el 2026-09-30: 13 de 13 llamadas
    -- a /rest/v1/rpc/plan_guardar con HTTP 400 y ese codigo, o sea que NINGUN guardado de la
    -- pagina llegaba a la base por el camino con transaccion.
    --
    -- El escritor acierta al no degradar a tabla por tabla cuando la FUNCION da error y no
    -- 404, asi que el efecto en la pagina era que todos los guardados se perdian sin que
    -- quedara nada escrito. Por eso esto no es un detalle de sintaxis: es la diferencia entre
    -- guardar y no guardar.
    --
    -- Aqui la clave se califica de los dos lados con su alias, y una clave de mas de una
    -- columna se compara como TUPLA: materials va por `ot,line_id`. Se deja de usar
    -- `= any(array(...))` porque `array(select ot, line_id from ex)` arma un array de DOS
    -- dimensiones, y `(a,b) = any(text[][])` no tiene operador: eso habria sido el error
    -- siguiente, escondido por el 42702.
    v_claves := string_to_array(v_clave, ',');
    v_izq := (select string_agg('t.' || quote_ident(btrim(c)), ', ' order by n)
                from unnest(v_claves) with ordinality as u(c, n));
    v_der := (select string_agg('ex.' || quote_ident(btrim(c)), ', ' order by n)
                from unnest(v_claves) with ordinality as u(c, n));
    -- El predicado se arma aparte con un `if` y NO con una expresion `case ... end`. Motivo
    -- medido 2026-09-30: un `case` de EXPRESION cierra con `end` pelado, no con `end case`, y
    -- el verificador de estructura plpgsql de este repo (tests/ddl-plpgsql-estructura.test.mjs)
    -- solo reconoce `end case`, asi que con el `case` marcaba el DDL bueno como descuadrado con
    -- tres errores inventados. El `if`/`end if` si lo ve, y asi el DDL se puede revisar con el
    -- verificador de verdad en vez de learned a ignorarlo: ver la limitacion 4 de su cabecera.
    if array_length(v_claves, 1) > 1 then
      v_where := format('(%s) = (%s)', v_izq, v_der);
    else
      v_where := format('%s = %s', v_izq, v_der);
    end if;
    v_sql := format(
      'update public.%I t set %s
         from jsonb_populate_recordset(null::public.%I, $1) ex
        where %s',
      v_tabla, v_asignar, v_tabla, v_where
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
    -- PostgREST bloquea DELETE sin WHERE. WHERE TRUE lo permite y borra todo.
    execute format('delete from public.%I where true', v_tabla);
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
         prepared_planning_by_ot = p_payload -> 'app_state' -> 'prepared_planning_by_ot',
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

-- Comprobacion: las columnas existen.
do $$
declare n integer;
begin
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'ot_configurations'
     and column_name in ('tipo_ot','tipo_trabajo','precio_manual','comercial_capturado_en');
  if n <> 4 then
    raise exception 'ot_configurations: faltan columnas de la captura comercial por OT (encontradas %)', n;
  end if;
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'app_state'
     and column_name = 'prepared_planning_by_ot';
  if n <> 1 then
    raise exception 'app_state: falta prepared_planning_by_ot';
  end if;
end $$;
