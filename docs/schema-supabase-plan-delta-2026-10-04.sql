-- ============================================================================
-- DELTA 2026-10-04:
--   (A) las 4 columnas de operations que NUNCA se aplicaron a produccion
--       (docs/schema-supabase-plan.sql:79-82)  -> RULE-SUP-045
--   (B) materials.requerido/emitido/pendiente de integer a numeric(18,6), para
--       que la cantidad fraccionaria de la BOM no se pierda  -> RULE-SUP-046
--       (decisio del usuario 2026-10-04: opcion A "fiel"). El RESTlet 2246 dejaba
--       de redondear (Math.round) en el mismo cambio, y la hoja vuelve a mostrar
--       la cantidad (0.127, 0.49742, 3.8) como antes de la migracion a Supabase.
--
-- MEDIDO 2026-10-04 contra la base de produccion (xtgtfjcwxcoxvixholpj) con la
-- clave publicable, sonda por columna (GET /rest/v1/operations?select=<col>&limit=1):
--   completado     -> HTTP 400 code 42703 "column operations.completado does not exist"
--   tipo           -> HTTP 400 code 42703 "column operations.tipo does not exist"
--   precio         -> HTTP 400 code 42703 "column operations.precio does not exist"
--   clasificacion  -> HTTP 400 code 42703 "column operations.clasificacion does not exist"
--   (las 8 del bloque anterior, :71-78, devuelven 200: SI existen)
--
-- Por que existe este archivo y no se re-aplica el completo:
--   1. docs/schema-supabase-plan.sql:79-82 se agrego al DDL en 1f404cf
--      (2026-10-01) y nunca se aplico; el writer del navegador ya las manda
--      desde 00b191d (2026-10-01), por eso el guardado por el camino viejo
--      (tabla por tabla) falla SIEMPRE en operations con HTTP 400.
--   2. El archivo completo NO se re-aplica: su linea :305-318 marca el bloque
--      :319-430 (create or replace function public.ingesta_mirror) como "COPIA
--      SUPERADA EL 2026-10-01 ... NO APLIQUES ESTA DEFINICION: CAMBIARIA DOS
--      COSAS QUE HOY FUNCIONAN" (RULE-SUP-038). Aplicar el archivo entero
--      pisaria el RPC desplegado con esa copia superada.
--
-- Como se aplica (sentencias idempotentes):
--   $env:SUPABASE_ACCESS_TOKEN = (Get-Clipboard -Raw).Trim()   # token sbp_, jamas en el repo
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-10-04.sql --diagnosticar
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-10-04.sql
--   Remove-Item Env:SUPABASE_ACCESS_TOKEN
--
-- Verificacion posterior (sonda por columna con la clave publicable):
--   (A) las 4 columnas de operations deben dar 200, y un guardado de plan por
--       el camino viejo debe dejar de fallar en operations.
--   (B) requerido/emitido/pendiente deben salir numeric(18,6). El ALTER convierte
--       los enteros existentes sin perderlos (0 sigue siendo 0); los NUMEROS
--       FRACCIONARIOS de verdad solo aparecen en la PROXIMA ingesta de NetSuite
--       (re-despliegue del RESTlet 2246, que ya no redondea: se hace en el panel
--       de NetSuite, lado usuario).
-- ============================================================================

alter table public.operations add column if not exists completado boolean not null default false;
alter table public.operations add column if not exists tipo text;
alter table public.operations add column if not exists precio numeric;
alter table public.operations add column if not exists clasificacion text;

comment on column public.operations.completado is 'Indica si la operacion ha sido completada (true) o no completada (false)';
comment on column public.operations.tipo is 'Tipo o clasificacion de la operacion (ej. doblado, corte, etc.)';
comment on column public.operations.precio is 'Precio unitario o total de la operacion';
comment on column public.operations.clasificacion is 'Clasificacion adicional de la operacion';

-- ----------------------------------------------------------------------------
-- (B) RULE-SUP-046: cantidad fraccionaria de la BOM.
-- MEDIDO 2026-10-04 en la base en vivo: 709 filas de materials, 50 OTs con
-- requerido=0 y pendiente=0 en TODAS sus filas (las que la hoja de inspeccion
-- muestra sin MP), y pendiente=0 en las 709 porque el RESTlet 2246 nunca la
-- escribio. Las columnas son integer, que no puede representar 0.127.
--
-- numeric(18,6) y no double: cantidad de tubo, no ciencia. precision 6 =
-- fraccion 0.000001, por debajo de cualquier medida de planta. El ALTER
-- convierte los enteros existentes sin perderlos (los 0 siguen siendo 0; los
-- enteros >0 conservan su valor). No hay cast manual: integer -> numeric es
-- implicito en Postgres y no rompe los datos ni el UNIQUE (ot, line_id).
--
-- Idempotente: si la columna ya es numeric(18,6), USING c::numeric(18,6) sobre
-- un numeric(18,6) es la identidad y no falla.
-- ----------------------------------------------------------------------------
alter table public.materials alter column requerido type numeric(18,6) using requerido::numeric(18,6);
alter table public.materials alter column emitido   type numeric(18,6) using emitido::numeric(18,6);
alter table public.materials alter column pendiente type numeric(18,6) using pendiente::numeric(18,6);

comment on column public.materials.requerido is 'Cantidad requerida por la BOM. Fraccionaria (cantidad_por_unidad del ensamble, p.ej. 0.127). NUMERIC desde el delta 2026-10-04 (antes integer y el 2246 la redondeaba a 0 con Math.round, RULE-SUP-046)';
comment on column public.materials.emitido is 'Cantidad emitida/facturada contra la OT (quantityshiprecv). Fraccionaria desde el delta 2026-10-04';
comment on column public.materials.pendiente is 'Calculada por el RESTlet 2246 como max(0, requerido - emitido), la misma formula del lector viejo 2244 (2244:363-366). Fraccionaria desde el delta 2026-10-04';
