-- ============================================================================
-- DELTA 2026-10-04b: las 4 columnas de operations en la whitelist del RPC.
--
-- (C) de la secuencia del 2026-10-04: despues de (A) las 4 columnas de
--     operations (docs/schema-supabase-plan-delta-2026-10-04.sql, ya aplicado
--     14/14) y (B) numeric(18,6) de materials (mismo archivo, aplicado;
--     RULE-SUP-046), este es el cambio de comportamiento que el usuario
--     decidio el 2026-10-04 con "AGREGALAS" (RULE-SUP-045): que plan_guardar
--     TAMBIEN persista completado/tipo/precio/clasificacion, y no las descarte
--     en silencio como lo hacia.
--
-- QUE ES LA WHITELIST Y POR QUE BASTA UN UPDATE. public.plan_tabla_escritura
-- dice, por tabla, que columnas la pagina puede escribir. plan_guardar la lee
-- EN TIEMPO DE EJECUCION (select modo, clave, columnas into ... where tabla =
-- v_tabla, docs/schema-supabase-plan.sql:736-737) y arma el SET con lo que
-- salga: la lista sale de la tabla, no del codigo de la funcion. Por eso:
--   - NO se re-despliega la funcion: su cuerpo no cambio, cambio la fila que
--     ella lee.
--   - NO se re-despliega el bundle del navegador: el writer ya manda las 4
--     desde filasOperations (supabase-writer.js:1764-1768, desde 00b191d).
--   - El UPDATE de abajo es el unico cambio, y queda en un diff, que es justo
--     lo que la comment de la tabla pide (docs/schema-supabase-plan.sql:589).
--
-- PISADA: NINGUNA. Con las 4 fuera de la lista, el SET del RPC no las nombraba
-- y quedaban en su valor anterior (el default: false / NULL / NULL / NULL).
-- Con ellas dentro, el SET las escribe con lo que trae el payload. Y lo que
-- trae el payload es EXACTAMENTE lo mismo que el camino viejo (guardarPorTablas,
-- upsert de toda la fila) escribe desde que el delta 2026-10-04 (A) creo las
-- columnas: completado=false (booleano), tipo='' (texto), precio=0 (numero),
-- clasificacion='' (texto), porque el state de la pagina no trae valor real de
-- las 4 (el reader mapOperations no las mapea y ninguna hoja las puebla). O
-- sea: el RPC deja de descartar lo que el camino viejo SIEMPRE escribio, y los
-- dos caminos dejan de comportarse distinto. No hay ningun valor del ERP que
-- la pagina este pisando: la ingesta 2246 no escribe estas columnas y hoy la
-- base solo tiene los defaults.
--
-- MEDIDO en el arbol (no en produccion): docs/schema-supabase-plan.sql:593-597
-- declara para operations las 27 columnas de la whitelist, con las 4 nuevas
-- despues de kit_pending. El UPDATE de abajo reproduce ESE arreglo tal cual,
-- y por eso la base y el archivo fuente quedan con la misma lista.
--
-- Como se aplica (una sentencia, idempotente: re-aplicar da el mismo estado):
--   $env:SUPABASE_ACCESS_TOKEN = (Get-Clipboard -Raw).Trim()   # token sbp_, jamas en el repo
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-10-04b.sql --diagnosticar
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-10-04b.sql
--   Remove-Item Env:SUPABASE_ACCESS_TOKEN
--
-- Verificacion posterior (con el token, Management API, o con la clave
-- publicable si la RLS de la tabla lo permite):
--   select columnas from public.plan_tabla_escritura where tabla = 'operations';
--   tiene que traer las 27, y entre ellas 'completado','tipo','precio',
--   'clasificacion'.
--
-- LO QUE SIGUE PENDING DESPUES DE ESTE UPDATE (no lo resuelve este delta):
--   1. El lector (mapOperations, supabase-reader.js) NUNCA lee las 4 de
--      vuelta. Son write-only de la pagina, IGUAL que las 8 columnas de plan
--      ya en la whitelist (num..kit_pending, ver MAPPING_GAPS en
--      supabase-reader.js): si alguien llega a escribir un valor real a esas
--      columnas por otra via, el proximo guardado las vuelve a poner en el
--      default. Eso es la decision tal cual se tomo (AGREGALAS = que el RPC
--      persista lo que el writer manda), no un fallo de este delta.
--   2. ingesta_mirror hace DELETE+INSERT de operations en cada ingesta de
--      NetSuite (~15 min) y NO escribe estas columnas (ni las 8 anteriores):
--      lo que la web escribio en operations se repone al estado de la
--      ingesta en la proxima pasada. PREEXISTENTE: pasa igual con las 8
--      columnas de plan que ya estaban en la whitelist. Se senala, no se
--      rediseña: cambiar el espejo es una decision aparte (RULE-SUP-015, un
--      writer por tabla).
-- ============================================================================

update public.plan_tabla_escritura
   set columnas = array['num','parte','contenido','prioridad','fecha_req','comentario','tiempo_fallback','kit_pending',
                        'completado','tipo','precio','clasificacion',
                        'secuencia','ct','operador','maquina','herramental','kit',
                        'fecha_inicio','hora_inicio','fecha_fin','hora_fin',
                        'estatus','locked','auto_frozen','subcontract_type','subcontract_days'],
       nota = 'Solo decisiones de plan: cuando, donde, con que, en que orden. Los datos del ERP (descripcion, cantidades, tiempos, tipo_insercion) NO se tocan, y la fila tiene que existir: la pagina no crea operaciones. `revision` NO esta en la lista a proposito: la pone la funcion con el numero nuevo. Si la mandara la pagina, cada fila quedaria con la revision que tenia la pagina y no con la que se guardo, que es un guardado por detras y hace que el cambio no se pueda atribuir a una revision. Las cuatro completado/tipo/precio/clasificacion son columnas de PLAN (docs/schema-supabase-plan.sql:79-82), no del ERP: la ingesta 2246 NO las escribe (quedan en default) y el writer del navegador ya las manda desde filasOperations (supabase-writer.js:1764-1768), asi que el camino viejo (guardarPorTablas) las escribe desde que el DDL las creo; anadirlas aqui (delta 2026-10-04b, RULE-SUP-045) hace que el camino RPC persista lo MISMO que el camino viejo, y dejen de descartarse en silencio. El lector (mapOperations) no las lee de vuelta, igual que num..kit_pending (ver MAPPING_GAPS): son write-only de la pagina.'
 where tabla = 'operations';

-- Comprobacion de la fila. Si el UPDATE no toco (tabla = 'operations' sin
-- coincidencia), esta raise deja el estado en vez de un silencio:
--   select columnas, length(array_to_string(columnas, ',')) from public.plan_tabla_escritura where tabla = 'operations';
do $$
declare
  v_cols text[];
  v_n int;
begin
  select columnas into v_cols from public.plan_tabla_escritura where tabla = 'operations';
  if v_cols is null then
    raise exception 'delta 2026-10-04b: la fila operations de plan_tabla_escritura no existe'
      using errcode = '23514';
  end if;
  v_n := array_length(v_cols, 1);
  if v_n <> 27 then
    raise exception 'delta 2026-10-04b: operations debe tener 27 columnas escribibles y tiene %', v_n
      using errcode = '23514';
  end if;
  if not (v_cols @> array['completado','tipo','precio','clasificacion']) then
    raise exception 'delta 2026-10-04b: la whitelist de operations no incluye las 4 nuevas'
      using errcode = '23514';
  end if;
end
$$;
