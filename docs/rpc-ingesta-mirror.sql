-- =============================================================================
-- RPC public.ingesta_mirror — EL ESPEJO ATOMICO. ESTE ARCHIVO ES LA COPIA CANONICA
-- =============================================================================
-- MEDIDO 2026-10-01. Este archivo ERA la v1 (lista de 7 tablas metida en el cuerpo)
-- y ya no lo es: ahora es la definicion que esta DESPLEGADA, con la whitelist movida
-- a la tabla. La historia de por que, porque el arrangement viejo costo una tarde:
--
--   1. docs/schema-supabase-plan.sql se aplico y dejo el RPC leyendo
--      public.ingesta_mirror_whitelist (una TABLA).
--   2. docs/schema-supabase-cierre-catalogos.sql se aplico DESPUES (2026-09-29,
--      32 sentencias) y su seccion 7 VOLVIO a definir el mismo RPC con una lista
--      de 17 tablas metida en el cuerpo.
--   3. `create or replace` no avisa que esta pisando una version. El paso 2 borro
--      el paso 1 sin dejar rastro, y el RPC quedo con la lista en el cuerpo.
--
-- Consecuencia medida el 2026-10-01: el importador de la hoja `Tramos` fallo con
--   ingesta_mirror 400 {"code":"P0001","message":"ingesta_mirror: tabla no permitida: inspection_routes"}
-- aunque la fila 'inspection_routes' estaba en la whitelist desde ese mismo dia, que
-- es el sintoma exacto de "la fila esta bien y la funcion ni la mira".
--
-- LAS OTRAS DOS COPIAS ESTAN MARCADAS COMO SUPERADAS. No las borres, no las
--apliques: se reaplicarian y volverian a pisar este RPC.
--   - docs/schema-supabase-cierre-catalogos.sql  seccion 7  (la que mato la v2)
--   - docs/schema-supabase-plan.sql               el bloque de ingesta_mirror
-- La de este archivo es la unica que se aplica. Y es la que cita Project Memory
-- (data-sources.json SUPABASE-PLAN, references).
--
-- -----------------------------------------------------------------------------
-- LO QUE NO SE PUEDE CAMBIAR AL TOCAR ESTA FUNCION
-- -----------------------------------------------------------------------------
-- 1. EL ARREGLO VACIO ES UN ESTADO LEGITIMO. Si `p_filas` es `[]` (el origen ya no
--    tiene filas), este RPC BORRA la tabla y devuelve `insertadas: 0`, con `ok: true`.
--    Por eso existe la rama `if jsonb_array_length(p_filas) > 0`. quitarla cambia el
--    significado de "no hay nada": hoy, sin esa rama, un payload vacio cae en
--    `array_length(v_cols, 1) is null` y el RPC REVienta, la transaccion hace rollback
--    y la tabla se queda con los datos anteriores. O sea: el espejo dejaria de
--    reflejar una tabla vacia y nadie sabria por que. La version de
--    docs/schema-supabase-plan.sql no tiene esa rama; por eso NO se copio de alla.
--
-- 2. EL DELETE ES UNA TAUTOLOGIA A PROPOSITO. `where id <> 'uuid nulo'` borra todas las
--    filas porque ningun id vale el uuid nulo. PostgREST exige WHERE en un DELETE, y
--    `WHERE true` no es valido para el (PGRST, medido el 2026-09-29).
--
-- 3. EL INSERT NOMBRA LAS COLUMNAS. Nunca `insert into %I select (...).*`: el `.*`
--    mete TODAS las columnas, `jsonb_populate_recordset` pone NULL en cada una que no
--    venga en el JSON, y un DEFAULT no salva a una columna que llega como NULL
--    explicito. Medido el 2026-09-30: las 7 tablas de la ingesta caian con 23502
--    'null value in column "id"' y, como el DELETE ya habia corrido dentro de la misma
--    transaccion, el rollback tapaba el sintoma. Por eso el INSERT excluye de la
--    lista las columnas que pone la base (id, created_at, updated_at).
--
-- 4. p_filas VIAJA COMO PARAMETRO DE EXECUTE, nunca dentro del texto de format(),
--    para que un valor con comillas no pueda romper la sentencia montada.
--
-- 5. ESTA ES SECURITY INVOKER Y REVOCADA A PUBLIC. El navegador escribe por las
--    POLITICAS RLS, no por este RPC. Si `anon` o `authenticated` pudieran ejecutarla,
--    cualquiera con la clave publicable (que viaja en el bundle publico de la pagina)
--    podria vaciar una tabla entera. Medido el 2026-10-01: execute anon=NO,
--    authenticated=NO, service_role=SI.
--
-- -----------------------------------------------------------------------------
-- COMO APLICAR
-- -----------------------------------------------------------------------------
-- Por la Management API, que es la via que hay:
--   $env:SUPABASE_ACCESS_TOKEN = (Get-Clipboard -Raw).Trim()
--   node scripts/aplicar-ddl.mjs docs/rpc-ingesta-mirror.sql
--   Remove-Item Env:\SUPABASE_ACCESS_TOKEN
-- No necesita SUPABASE_DB_PASSWORD, que no esta en el entorno.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 1. La v1 queda como tombstone. Ya no se usa; sigueExistiendo es deliberado:
--    tirarla podria romper a alguien que todavia la llame, y lo que hace es raise.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. El RPC.
-- -----------------------------------------------------------------------------
create or replace function public.ingesta_mirror(p_tabla text, p_filas jsonb)
  returns jsonb
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
  -- LA WHITELIST ES LA TABLA, NO ESTA LISTA. MEDIDO 2026-10-01: por 30 años de
  -- este proyecto la lista vivio en este cuerpo, y agregar una tabla obligaba a
  -- reescribir la funcion. Con la tabla, agregar una tabla es un INSERT y el
  -- `create or replace` de este archivo no se toca. Que se lea de
  -- public.ingesta_mirror_whitelist y NO de un array aqui es cosa de tests
  -- (tests/ddl-plan.test.mjs:123 y tests/rpc-ingesta-mirror.test.mjs).
  if not exists (
       select 1 from public.ingesta_mirror_whitelist w where w.tabla = p_tabla
     ) then
    raise exception 'ingesta_mirror: tabla no permitida: % (la lista es public.ingesta_mirror_whitelist)', p_tabla;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'ingesta_mirror: p_filas debe ser un arreglo jsonb';
  end if;
  v_tabla := format('public.%I', p_tabla)::regclass;

  execute format('delete from %s where id <> ''00000000-0000-0000-0000-000000000000''', v_tabla);
  get diagnostics v_borradas = row_count;

  -- MEDIDO 2026-10-01, ver el punto 1 de la cabecera: un payload VACIO borra la
  -- tabla y es un resultado correcto. Esta rama no es una optimizacion.
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
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Solo service_role. Ver el punto 5 de la cabecera: esto borra la tabla entera.
--    Medido el 2026-10-01, ya estaba asi en la base; se repite aqui para que el
--    archivo sea por si solo suficiente.
-- -----------------------------------------------------------------------------
revoke execute on function public.ingesta_mirror(text, jsonb) from anon;
revoke execute on function public.ingesta_mirror(text, jsonb) from authenticated;
revoke execute on function public.ingesta_mirror(text, jsonb) from public;
revoke execute on function public.ingesta_mirror_v1(text, jsonb) from anon;
revoke execute on function public.ingesta_mirror_v1(text, jsonb) from authenticated;
revoke execute on function public.ingesta_mirror_v1(text, jsonb) from public;
grant execute on function public.ingesta_mirror(text, jsonb) to service_role;
grant execute on function public.ingesta_mirror_v1(text, jsonb) to service_role;

comment on function public.ingesta_mirror(text, jsonb) is
  'Espejo atomico: borra la tabla y reinserta lo que llega, en una sola transaccion. Admite las filas de public.ingesta_mirror_whitelist y solo service_role puede ejecutarla.';
comment on function public.ingesta_mirror_v1(text, jsonb) is
  'Tombstone. La v1 (lista de 7 tablas en el cuerpo) ya no se usa; ingesta_mirror lee public.ingesta_mirror_whitelist. Se conserva para que quien la llame reciba un raise que dice a donde ir.';