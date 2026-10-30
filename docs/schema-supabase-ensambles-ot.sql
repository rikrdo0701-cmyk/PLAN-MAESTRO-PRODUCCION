-- =============================================================================
-- 1. ENSAMBLES_OT — LO QUE REALMENTE SE ENSAMBLÓ, UN RENGLÓN POR EVENTO
-- -----------------------------------------------------------------------------
-- ESTADO: APLICADO. Esta es la forma REAL de la tabla en el proyecto, MEDIDA
-- 2026-10-29 contra la base: `id, build_id, fecha, ot, wo_internal_id, articulo,
-- descripcion, cantidad, ubicacion, revision, created_at, updated_at` — con
-- `revision` y SIN `build_tranid`.
--
-- OJO CON `build_tranid`: el RESTlet 2246 la manda (netsuite-restlet-unificado-
-- supabase.js:460-498, la funcion `ensambles_`) y la tabla NO la tiene. `ingesta_mirror`
-- valida las columnas del payload contra la tabla y rechaza las desconocidas, asi que
-- esa columna hacia que la ingesta DE ENSAMBLES fallara con:
--
--   ingesta_mirror: la tabla ensambles_ot no tiene las columnas build_tranid
--
-- y la tabla quedaba en 0 filas. El codigo de la ingesta (19-appscript-ingesta-supabase.js)
-- la QUITA del payload antes de escribir (busca `delete copia.build_tranid`), porque el
-- reporte no la lee. Si algun dia se necesita, es un ALTER de reconciliacion decidido a
-- proposito (docs/ensambles-ot-reconciliar-build-tranid.sql), no un desliz del RESTlet.
--
-- -----------------------------------------------------------------------------
-- Petición del usuario 2026-10-25: un reporte "Liberación real" con
--   fecha | OT | artículo | cantidad | precio unitario | monto
-- de lo que se ensambla, de la planta MM del Llano, de los últimos 2 meses, y
-- solo lo que entra al almacén 1 viniendo de una orden de trabajo.
--
-- POR QUÉ UNA TABLA NUEVA Y NO UNA COLUMNA DE `work_orders`. `work_orders` tiene
-- UNA fila por OT, y el usuario confirmó el 2026-10-25 que "hay ensambles
-- parciales en varios eventos": la misma OT se puede ensamblar en fechas
-- distintas y con cantidades distintas. Una columna no puede guardar varios
-- eventos, y sumarlos en la OT perdería justo la fecha de cada uno, que es la
-- columna por la que el reporte se ordena.
--
-- QUÉ ES CADA COLUMNA Y DE DÓNDE SALE (NetSuite, SuiteQL):
--   build_id      = transaction.id de la transacción de ensamblado (Assembly
--                   Build). Es la clave natural: UN evento de ensamblado.
--   fecha         = transaction.trandate de ese ensamblado. ES LA FECHA REAL
--                   DEL ENSAMBLE, no la de vencimiento de la OT ni la de su
--                   última operación (decisión del usuario 2026-10-25).
--   ot            = transaction.tranid de la OT de origen (el documento desde
--                   el que se hizo el ensamblado). Sin OT no entra: un
--                   ensamblado manual no tiene de dónde colgar el reporte.
--   wo_internal_id= transaction.id de esa OT.
--   articulo      = itemid del artículo ensamblado (el mismo código que el
--                   reporte muestra hoy en la columna Artículo).
--   descripcion   = item.description del artículo ensamblado.
--   cantidad      = la cantidad de la línea principal del ensamblado, en
--                   unidades del artículo. Numeric, no entero: un ensamblado de
--                   0.01 existe en esta cuenta (medido en work_orders, folio
--                   1984) y redondearlo sería perder piezas.
--   ubicacion     = la ubicación del movimiento; solo entra la 1, la misma
--                   "PLANTA : Planta MM del Llano" que ya filtra todo el espejo
--                   (RULE-SUP-013). Decision del usuario 2026-10-25.
--   revision      = 0, como las otras tablas del espejo (contrato del RESTlet).
--   created_at / updated_at los pone la base, como en las demás.
--
-- POR QUÉ ES UN ESPEJO. La ingesta escribe con public.ingesta_mirror, que
-- borra y reescribe la tabla en una transacción (RULE-SUP-048). Si NetSuite no
-- devuelve la acción, la tabla se vacía y se dice en el log, en vez de mostrar
-- ensamblados viejos como si fueran de ahora (que es justo lo que este reporte
-- ordena por fecha).
--
-- OJO: EL PRECIO NO ESTÁ AQUÍ, Y ES DELIBERADO. El monto se calcula en la
-- página con la MISMA función que usa el plan para valorar la OT
-- (`effectiveUnitPriceForOt`: precio capturado a mano para la OT → última venta
-- de NetSuite → precio de referencia del catálogo, el más alto de los que
-- existan, 0 si ninguno). Guardar el precio en esta tabla lo congelaría en el
-- instante de la ingesta y el reporte dejaría de cuadrar con el borrador.
-- =============================================================================

create table if not exists public.ensambles_ot (
  id             uuid primary key default gen_random_uuid(),
  build_id       text not null unique,
  fecha          date,
  ot             text not null default '',
  wo_internal_id text not null default '',
  articulo       text not null default '',
  descripcion    text not null default '',
  cantidad       numeric(18,6) not null default 0,
  ubicacion      integer not null default 1,
  revision       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- La consulta del reporte: los últimos 2 meses, de lo más nuevo a lo más viejo.
create index if not exists idx_ensambles_ot_fecha on public.ensambles_ot (fecha desc);
create index if not exists idx_ensambles_ot_ot on public.ensambles_ot (ot);

-- =============================================================================
-- 2. RLS — LEER SÍ, ESCRIBIR NO
-- -----------------------------------------------------------------------------
-- Mismo criterio que el resto del espejo: la web lee con la clave anón o una
-- sesión autenticada; nadie escribe desde la web. Quien escribe es la ingesta
-- de Apps Script con la service key, que se salta RLS.
-- =============================================================================
alter table public.ensambles_ot enable row level security;
drop policy if exists lectura_web on public.ensambles_ot;
drop policy if exists lectura_app on public.ensambles_ot;
create policy lectura_app on public.ensambles_ot for select to authenticated using (true);

-- =============================================================================
-- 3. LA WHITELIST DEL RPC
-- -----------------------------------------------------------------------------
-- `public.ingesta_mirror` valida el nombre de la tabla contra
-- `public.ingesta_mirror_whitelist`. Agregar una tabla es un INSERT aquí; la
-- función no se toca (docs/rpc-ingesta-mirror.sql, punto 2).
-- =============================================================================
insert into public.ingesta_mirror_whitelist (tabla, nota) values
  ('ensambles_ot', 'espejo de NetSuite: eventos de ensamblado de la planta 1 (RULE-SUP-078)')
on conflict (tabla) do update set nota = excluded.nota;