-- =============================================================================
-- Reconciliacion posible de public.ensambles_ot con build_tranid. NO APLICADO, y
-- probablemente sobra: la solucion que CORRIO fue quitar la columna del payload.
-- =============================================================================
--
-- CONTEXTO MEDIDO 2026-10-29 en produccion (no adivinado):
--   - La tabla real tiene: id, build_id, fecha, ot, wo_internal_id, articulo,
--     descripcion, cantidad, ubicacion, revision, created_at, updated_at.
--   - El RESTlet 2246 (`ensambles_`, netsuite-restlet-unificado-supabase.js) manda
--     `build_tranid` en cada fila.
--   - `ingesta_mirror` valida las columnas del payload contra la tabla y rechaza las
--     desconocidas con "la tabla ensambles_ot no tiene las columnas build_tranid".
--     Con eso la ingesta de ensambles fallaba y la tabla quedaba en 0 filas.
--   - La solucion aplicada: 19-appscript-ingesta-supabase.js QUITA `build_tranid` del
--     payload antes de escribir. La tabla ya se puebla. El reporte "Liberacion real"
--     (supabase-reader.js, readEnsambleEvents) NO lee build_tranid.
--
-- QUE PASARIA SI SE QUISIERA GUARDARLA. La columna es text y la clave sigue siendo
-- build_id. Agregarla no rompe nada, pero TAMPOCO sirve para nada hoy: ningun lector
-- la pide. El unico motivo para correr esto seria que un reporte futuro la necesite, y
-- entonces su cambio va con el lector y con la ingesta (que dejaria de quitarla).

-- 1. (OPCIONAL) Columna que el RESTlet manda y la tabla no tiene.
-- alter table public.ensambles_ot
--   add column if not exists build_tranid text not null default '';

-- 2. Para que la ingesta la guarde, hay que quitar de 19-appscript-ingesta-supabase.js
--    el bloque `delete copia.build_tranid` (que hoy existe a proposito).

-- 3. Verificacion despues de una ingesta.
select count(*) as filas, count(build_id) as con_clave from public.ensambles_ot;