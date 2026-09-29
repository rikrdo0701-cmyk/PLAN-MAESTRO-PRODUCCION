-- =============================================================================
-- RPC ingesta_mirror — MIRROR ATOMICO DE LAS 7 TABLAS DE LA INGESTA
-- =============================================================================
-- Sustituye al DELETE + POST de la ingesta (commit c883d5e). Mismo objetivo:
-- cada corrida deja la tabla como espejo EXACTO de lo que devuelve NetSuite
-- (cero datos antiguos). La diferencia es que todo ocurre DENTRO de una sola
-- transaccion de Postgres:
--
--   delete todos; insert los nuevos;  ->  o COMMIT (200) o ROLLBACK (400).
--
-- Si el insert falla (violacion de constraint, tipo no parseable, columna
-- desconocida), la transaccion se revierte COMPLETA y la tabla queda con los
-- datos ANTERIORES a la corrida, NUNCA vacia ni a medias. Con el DELETE+POST
-- previo, en cambio, un fallo en el POST dejaba la tabla vacia hasta la
-- siguiente corrida (15 min despues).
--
-- QUIEN LA LLAMA: la ingesta de Google Apps Script (appscript-ingesta-supabase.gs,
-- funcion ingesta) via POST /rest/v1/rpc/ingesta_mirror con la service role key.
-- El RESTlet de NetSuite NO cambia: sigue siendo una sola llamada { accion:'todas' }.
--
-- COMO CASTEA LOS TIPOS: el payload del RESTlet trae numeros reales (JSON
-- number) y fechas ISO. Se inserta contra el TIPO real de cada columna via
-- jsonb_populate_recordset(null::<tabla>): el cast lo hace Postgres, no JS.
--
-- SEGURIDAD:
--   - p_tabla esta en una whitelist fija: no hay forma de apuntar a otra tabla.
--   - Las columnas a insertar se toman del payload y se cruzan contra
--     information_schema: las que no existen en la tabla RAISAN (igual que el
--     PGRST204 que se fue a cazar), no se descartan en silencio.
--   - id/created_at/updated_at las genera la base por su default (gen_random_uuid
--     y now()): no vienen del RESTlet.
--   - SECURITY INVOKER + revoke de PUBLIC: solo service_role (la service key
--     del Apps Script) puede ejecutarla. anon no.
--   - search_path fijo a public y tabla resuelta como public.<tabla>: sin trucos
--     de search_path.
-- =============================================================================

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
  v_cols        text[];      -- columnas a insertar (presentes en payload y en la tabla)
  v_cols_i      text;        -- '"col1","col2"...' para el INSERT
  v_cols_r      text;        -- 'r."col1",r."col2"...' para el SELECT
  v_desconoc    text[];      -- columnas del payload que NO existen en la tabla
  v_borradas    bigint;
  v_insertadas  int;
  v_sql         text;
begin
  -- Whitelist: las 7 tablas de la ingesta, nada mas.
  if p_tabla not in ('work_orders','operations','materials','items','machines',
                     'inventory','sales_orders') then
    raise exception 'ingesta_mirror: tabla no permitida: %', p_tabla;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'ingesta_mirror: p_filas debe ser un arreglo jsonb';
  end if;
  v_tabla := format('public.%I', p_tabla)::regclass;

  -- Borrar TODO (esto es un mirror) y dejar que el insert nuevo viva en la
  -- misma transaccion: si algo falla, el rollback restaura lo anterior.
  execute format('delete from %s', v_tabla);
  get diagnostics v_borradas = row_count;

  -- Columnas: las del payload, filtradas contra el esquema real.
  if jsonb_array_length(p_filas) > 0 then
    select array_agg(c) into v_cols
      from jsonb_object_keys(p_filas -> 0) as c;

    -- Columnas desconocidas -> RAISE (como el PGRST204): nunca silencioso.
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

    -- id/created_at/updated_at las genera la base; no vienen del RESTlet.
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

    -- jsonb_populate_recordset contra el tipo REAL de la tabla: Postgres casta
    -- number->integer/numeric, string ISO->date/timestamptz, bool->boolean, etc.
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