-- =============================================================================
-- LIMPIEZA DE LAS COPIAS DE `materials` — MEDIDO 2026-10-04 — YA NO HACE FALTA
-- -----------------------------------------------------------------------------
-- ESTADO ACTUAL (2026-10-04T18:48Z): LAS COPIAS YA NO ESTAN, y no hubo que aplicar
-- este archivo. La ingesta forzada de esa hora reescribio `materials` con los 349
-- renglones del ERP y las 348 copias desaparecieron solas, porque
-- `public.ingesta_mirror` hace `delete` de la tabla completa + `insert` en una sola
-- transaccion (docs/rpc-ingesta-mirror.sql:123). Respuesta de esa corrida: `ok:true`,
-- `materials: 349` filas escritas, `vaciadas: []`, `noSePudoVaciar: []`, `errores: []`.
-- Y el escritor que las creaba ya no esta desplegado en el bundle de Pages (trae el
-- `lineId` del ERP), asi que tampoco se recrean.
-- O sea: este archivo queda como REGISTRO de lo que habia y como guarda por si hay
-- que repetirla. NO lo apliques sin volver a medir: su guarda aborta si el numero de
-- copias no es 348.
-- -----------------------------------------------------------------------------
-- QUE HACE. Borra SOLO las filas que creo el escritor de la pagina por escribir
-- `line_id` con el UUID de la fila en vez del id de renglon de NetSuite. No toca
-- ningun RENGLON DEL BOM. NO ES DESTRUCTIVO PARA NADA QUE NO SEA DUPLICADO, y
-- aun asi NO SE APLICA sin que el usuario lo diga (ver "POR QUE HAY QUE
-- PREGUNTAR" al final).
--
-- -----------------------------------------------------------------------------
-- 1. LO QUE SE MEDIO EN LA BASE EN VIVO (2026-10-04, con sesion)
-- -----------------------------------------------------------------------------
--   filas de materials .................................. 697
--   (ot, componente) distintos ......................... 348
--   filas escritas por la ingesta (line_id entero) ..... 349
--   filas escritas por la pagina (line_id con UUID) = COPIAS  348   <- estas son las que sobran
--   filas de mas (filas - pares, el par de 3 aporta 2) .. 349
--   (ot, componente) con DOS O MAS RENGLONES REALES ....   1   (OT 3776 / MP00094)
--   (ot, componente) SIN NINGUN renglon real ............   0
--
--   Las originales de la ingesta se distinguen tambien por `revision` 0 y
--   `updated_at` 2026-10-04T07:48:42Z; las COPIAS tienen `revision` 4 y `updated_at`
--   2026-10-04T16:32:44Z: las creo un guardado de plan DESPUES de la ultima ingesta.
--
--   El caso de la OT 3776 es el que hace peligroso un `delete` por (ot, componente):
--     line_id=2     (ERP)   requerido=6.27
--     line_id=3     (ERP)   requerido=330
--     line_id=bda4aa98-...  (COPIA) requerido=6.27
--   Son DOS RENGLONES REALES del BOM con la misma MP (comp.id 1961 en los dos) y
--   cantidades distintas, mas la copia. Un borrado por (ot, componente) se llevaria
--   un renglon de verdad. Por eso la COPIA se identifica por su `line_id`, no por el
--   componente: `comp.id` (el renglon del BOM) SIEMPRE es un entero, y el UUID que
--   escribio la pagina no lo es.
--
-- -----------------------------------------------------------------------------
-- 2. POR QUE HAY 348 COPIAS SI LA INGESTA BORRA LA TABLA ENTERA
-- -----------------------------------------------------------------------------
-- `public.ingesta_mirror` (docs/rpc-ingesta-mirror.sql:123) hace
-- `delete from public.materials ...` + `insert` en cada corrida, o sea que las copias
-- no sobreviven a la siguiente ingesta: la ultima corrida (2026-10-04T07:48:42Z,
-- 349 filas) dejo la tabla limpia y las 348 copias las creo DESPUES un guardado de
-- plan desde el bundle de Pages desplegado, que todavia escribia
-- `line_id = id` (arreglado en src/web/shared/supabase-writer.js, pendiente de push).
--
-- O sea que este DELETE es una limpieza de un estado TRANSITORIO: la ingesta lo
-- desharia sola en la proxima corrida. Se deja escrito igual, para no depender del
-- calendario y para que la base quede medible ahora.
--
-- MEDIDO 2026-10-04 (lo que la ingestion hace con las copias ahora). Con RULE-SUP-048
-- ("toda ingesta borra los valores previos y reescribe") la proxima corrida de
-- `ingesta_mirror` borra `materials` entera antes de insertar, asi que estas 348 filas
-- desaparecen solas en cuanto corra la ingesta — y si `materials` llegara a fallar, la
-- tabla se VACIA tambien, de modo que las copias ya no pueden quedar escondidas "como
-- si fueran de la corrida anterior". Lo que sigue siendo necesario para que NO vuelvan
-- es el push del fix de `lineId` al bundle de Pages (src/web/shared/supabase-writer.js),
-- porque mientras el escritor viejo siga desplegado cada guardado de plan las recrea
-- entre una ingesta y la siguiente.
--
-- -----------------------------------------------------------------------------
-- 3. PRIMERO SE MIDE (no escribe nada)
-- -----------------------------------------------------------------------------
select
  count(*)                                                          as filas,
  count(*) filter (where line_id ~ '^[0-9]+$')                       as renglones_del_bom,
  count(*) filter (where line_id !~ '^[0-9]+$')                      as copias,
  count(distinct (ot, componente))                                   as pares_ot_componente
from public.materials;

-- Las 5 primeras copias, para MIRARLAS antes de borrarlas (no son un patron, son filas):
select id, ot, componente, componente_id, requerido, emitido, pendiente, line_id
from public.materials
where line_id !~ '^[0-9]+$'
order by ot, componente
limit 5;

-- -----------------------------------------------------------------------------
-- 4. EL BORRADO (una sola vez, dentro de una transaccion)
-- -----------------------------------------------------------------------------
begin;

-- El cortafuegos: si el numero de filas a borrar NO es el medido, se aborta todo.
-- Con esto, un cambio en la base entre la medicion y el borrado deja la tabla igual
-- en vez de borrar lo que sea que haya aparecido.
do $$
declare
  v_copias integer;
begin
  select count(*) into v_copias from public.materials where line_id !~ '^[0-9]+$';
  if v_copias <> 348 then
    raise exception 'LIMPIEZA ABORTADA: hay % copias y el medido fue 348; vuelve a medir', v_copias;
  end if;
end $$;

delete from public.materials where line_id !~ '^[0-9]+$';

-- Lo que tiene que quedar despues: 349 filas, todas con `line_id` entero.
select count(*) as filas,
       count(*) filter (where line_id ~ '^[0-9]+$') as renglones_del_bom
from public.materials;

commit;   -- o `rollback;` mientras se quiere ver el resultado sin dejar el cambio
--
-- -----------------------------------------------------------------------------
-- 5. QUE NO SE TOCA
-- -----------------------------------------------------------------------------
--   - Las filas con `line_id` entero: son los RENGLONES DEL BOM, uno por `comp.id`.
--     La OT 3776 / MP00094 conserva SUS DOS renglones (6.27 y 330), porque los dos
--     son reales: `line_id` 2 y 3.
--   - `route` y `drawing`: no viven en `materials` (son de `inspection_routes`, por
--     COMPONENTE), asi que borrar una copia no pierde ningun dato de tramo.
--   - La hoja de inspeccion ya NO depende de que estas filas esten: `inspection-core.js`
--     (`inspectionMaterialsUnicos`, y `renderDetail` en inspection-app.js) quita las
--     copias aunque la base siga sucia. Por eso la hoja se puede dejar limpia aunque
--     el DELETE se decida mas adelante.
--
-- -----------------------------------------------------------------------------
-- 6. POR QUE HAY QUE PREGUNTAR
-- -----------------------------------------------------------------------------
-- Son 348 filas en produccion y un `delete` no se revierte solo (RULE-SUP-021: un
-- script que "limpia" duplicados borra filas que nadie pidio borrar). Ademas, con el
-- escritor ya arreglado y la ingesta borrando la tabla en cada corrida, la decision
-- de borrar AHORA o esperar la proxima corrida cambia poco el resultado. Por eso el
-- archivo queda escrito y SIN APLICAR hasta que el usuario lo diga.
-- =============================================================================
