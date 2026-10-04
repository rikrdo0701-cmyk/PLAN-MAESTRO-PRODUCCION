-- ============================================================================
-- DELTA 2026-10-04: las 4 columnas de operations que NUNCA se aplicaron a
-- produccion (docs/schema-supabase-plan.sql:79-82).
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
-- Como se aplica (solo estas 4 sentencias, idempotentes):
--   $env:SUPABASE_ACCESS_TOKEN = (Get-Clipboard -Raw).Trim()   # token sbp_, jamas en el repo
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-10-04.sql --diagnosticar
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-10-04.sql
--   Remove-Item Env:SUPABASE_ACCESS_TOKEN
--
-- Verificacion posterior (sonda por columna con la clave publicable): las 4
-- columnas deben dar 200, y un guardado de plan por el camino viejo debe dejar
-- de fallar en operations.
-- ============================================================================

alter table public.operations add column if not exists completado boolean not null default false;
alter table public.operations add column if not exists tipo text;
alter table public.operations add column if not exists precio numeric;
alter table public.operations add column if not exists clasificacion text;

comment on column public.operations.completado is 'Indica si la operacion ha sido completada (true) o no completada (false)';
comment on column public.operations.tipo is 'Tipo o clasificacion de la operacion (ej. doblado, corte, etc.)';
comment on column public.operations.precio is 'Precio unitario o total de la operacion';
comment on column public.operations.clasificacion is 'Clasificacion adicional de la operacion';
