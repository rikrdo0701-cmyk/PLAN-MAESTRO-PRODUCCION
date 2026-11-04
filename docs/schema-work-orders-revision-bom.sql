-- =============================================================================
-- work_orders.revision_bom -- LA REVISION QUE IMPRIME LA HOJA DE INSPECCION
--
-- POR QUE ESTA COLUMNA. La hoja de inspeccion tiene una celda rotulada REV y el
-- enrutamiento de la OT en NetSuite ya trae la revision: `billofmaterialsrevision`
-- llega como "<BOM> REV <letra>" (OT 2752 -> "CCA 519 C REV C"). El RESTlet 2244
-- la lee y el camino de Apps Script la imprime; el camino de PAGES no, porque lee
-- de Supabase y la revision nunca llegaba a la base.
--
-- POR QUE NO SE USA LA COLUMNA QUE YA EXISTE. `work_orders.revision` es `integer`
-- y guarda el CONTADOR DE GUARDADO del plan (filasWorkOrders,
-- src/web/shared/supabase-writer.js). Son dos datos distintos, y una letra no cabe
-- en una columna entera; ademas el lector deja esa columna vacia a proposito
-- (MAPPING_GAPS.work_orders, src/web/shared/supabase-reader.js).
--
-- QUIEN LA ESCRIBE: SOLO LA INGESTA. El RESTlet 2246 la manda ya recortada a la
-- letra (revisionDesdeBom_, netsuite-restlet-unificado-supabase.js) y
-- src/server/19-appscript-ingesta-supabase.js la escribe por ingesta_mirror. El
-- navegador NO la escribe (RULE-SUP-010, un escritor por columna): su UPSERT de
-- work_orders manda solo sus columnas del plan y PostgREST no toca las demas.
--
-- COMO SE APLICA (Management API, la via disponible; ver scripts/aplicar-ddl.mjs):
--   $env:SUPABASE_ACCESS_TOKEN = (Get-Clipboard -Raw).Trim()
--   node scripts\aplicar-ddl.mjs docs\schema-work-orders-revision-bom.sql
--   Remove-Item Env:\SUPABASE_ACCESS_TOKEN
--
-- ORDEN OBLIGATORIO: este DDL va ANTES del proximo redespliegue del 2246 y de la
-- siguiente corrida de la ingesta. `ingesta_mirror` nombra las columnas de la fila
-- 0, y con la columna ausente la escritura falla con "columnas no existen en
-- public.work_orders: revision_bom" y work_orders se queda sin escribir
-- (RULE-SUP-048).
--
-- MEDIDO 2026-11-04: la OT 2752 responde en el 2244/1 `revision: "C"`,
-- `bomRevision: "CCA 519 C REV C"`.
-- =============================================================================

alter table public.work_orders
  add column if not exists revision_bom text not null default '';

comment on column public.work_orders.revision_bom is
  'REV del BOM/enrutamiento de NetSuite (billofmaterialsrevision, recortada a la letra). La imprime la hoja de inspeccion. La escribe solo la ingesta (2246).';

-- VERIFICACION, a mano despues de aplicar. Debe devolver UNA fila, text, NO nula
-- y con default ''::text:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'work_orders'
--      and column_name = 'revision_bom';
