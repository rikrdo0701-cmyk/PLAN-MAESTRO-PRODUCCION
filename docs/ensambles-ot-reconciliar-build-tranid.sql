-- Reconciliacion de public.ensambles_ot con el espejo. PENDIENTE DE APROBACION, NO APLICADO.
--
-- POR QUE EXISTE. MEDIDO 2026-10-29 22:54 desde la ingesta real (doPost en Apps Script):
--   ingesta_mirror: la tabla ensambles_ot no tiene las columnas build_tranid
--   => 400 P0001, la tabla NO se escribe y queda en 0 filas (select count(*) = 0).
-- La tabla que hay en el proyecto es la de docs/rpc-ingesta-mirror.sql (tiene build_tranid,
-- no tiene revision). El archivo docs/schema-supabase-ensambles-ot.sql, que era la version
-- vigente que se creia aplicada, nunca se aplico. La diferencia importa en tres puntos:
--   1) el RESTlet manda `build_tranid` en cada fila -> falta la columna;
--   2) esa copia NO trae el `delete` del espejo (RULE-SUP-048) -> nunca vaciaria la tabla;
--   3) ese DDL declara `revision` y la tabla real no la tiene -> el codigo ya no la rellena
--      (19-appscript-ingesta-supabase.js, PP_COLUMNAS_NOT_NULL_DEFAULT_ y las dos listas).
--
-- DECISION DEL USUARIO: si `build_tranid` es un dato que el reporte necesita. Hoy el reporte
-- "Liberacion real" (supabase-reader.js, readEnsambleEvents) NO lo lee: pide
-- build_id,fecha,ot,wo_internal_id,articulo,descripcion,cantidad,ubicacion. Si no se necesita,
-- se puede dejar como `not null default ''` y no tocar el codigo; si se necesita, es una
-- columna nueva del reporte y va con su cambio en el lector y en la tabla.
--
-- NADA DE ESTO REESCRIBE `delete` + `insert`: es la copia canonica la que tiene que quedar
-- vigente. Este archivo solo reconcilia columnas.

-- 1. Columna que el RESTlet manda y la tabla no tiene.
alter table public.ensambles_ot
  add column if not exists build_tranid text not null default '';

comment on column public.ensambles_ot.build_tranid is
  'tranid del Assembly Build (transaction.tranid, netsuite-restlet-unificado-supabase.js:464). No es la clave: la clave es build_id.';

-- 2. El espejo tiene que VACIAR antes de reinsertar (RULE-SUP-048). Comprobacion, no cambio:
--    se espera el `delete from public.ensambles_ot;` de docs/rpc-ingesta-mirror.sql.
select p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'ingesta_mirror';

-- 3. Lectura para la web: la columna se agrega a la vista, no se toca la politica (lectura_app).
--    Si el reporte se queda como esta, este grant sobra y se puede no correr.
-- grant select (build_tranid) on public.ensambles_ot to authenticated;

-- 4. Verificacion despues de correr la ingesta desde la pagina.
select count(*) as filas, count(build_tranid) as con_tranid from public.ensambles_ot;
