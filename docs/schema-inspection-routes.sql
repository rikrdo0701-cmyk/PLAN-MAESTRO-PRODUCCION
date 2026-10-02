-- =============================================================================
-- CATALOGO DE TRAMOS DE INSPECCION (migrado de la hoja `Tramos`)
--
-- POR QUE ESTA TABLA. La fuente del catalogo de tramos de la hoja de inspeccion
-- era la hoja `Tramos` del libro INSPECTION_SPREADSHEET_ID
-- (16-inspection-service.js: PP_INSPECTION_ROUTES_SHEET = 'Tramos', columnas
-- Articulo | Materia prima | Tramo | DIBUJO | Ultima modificacion). Es un dato
-- MANUAL que se edita desde dos lugares de la pagina (la pestana de inspeccion y
-- la tabla de Catálogos) y desde el catalogo no llegaba a Supabase: la web leia
-- de `materials`, que es una tabla DEL ERP, y por ahi no existe el TRAMO.
--
-- QUE SE MIGRÓ, EXACTAMENTE. La hoja `Tramos` completa, con su clave natural
-- (Articulo, Materia prima) y su regla de desempate: si hay dos filas con la misma
-- clave, GANA LA ULTIMA (16-inspection-service.js PP_Inspection_routeIndex_ y el
-- test "ambas definiciones publicas listan la ultima fila por articulo y material",
-- que existe precisamente porque la hoja llega con A-100 y a-100 en dos filas).
-- El importador PP_migrarTramosASupabase_ (16-inspection-service.js) aplica esa
-- misma regla, o sea que la tabla tiene UNA fila por clave y jamas dos.
--
-- LA COLUMNA `clave`, Y POR QUE NO ES UN (articulo, material). El emparejamiento
-- de la hoja es por TEXTO NORMALIZADO, en dos niveles, y por eso una clave de dos
-- columnas exactas no alcanza:
--   nivel 1  PP_normalizeKey_            trim + mayusculas + sin acentos + espacios -> "_"
--   nivel 2  PP_Inspection_routeLooseKey_ ademas quita TODA la puntuacion
-- (17-inspection-drawing-service.js:74-109). "A-100" y "A 100" son la misma fila
-- para el nivel 2 y son dos para el nivel 1. `clave` guarda el nivel 1, que es el
-- que ya usaba el indice; el nivel 2 se sigue calculando al LEER, en JS, igual que
-- hasta ahora, para no cambiar el comportamiento de la busqueda. Una columna de
-- clave (y no un indice sobre una expresion) es ademas lo que hace que el UPSERT
-- del escritor funcione: PostgREST solo resuelve on_conflict contra un indice
-- UNICO sobre columnas, no sobre expresiones.
--
-- UN ESCRITOR. La PAGINA, con su sesion, por PPSupabaseWriter.guardarInspectionRoute
-- (supabase-writer.js). Apps Script SOLO LEE (service role) para la hoja de
-- impresion, y su `saveInspectionLink` dejo de escribir: si escribiera, habria dos
-- escritores sobre la misma tabla y el que perdiera seria el ultimo en escribir
-- (RULE-SUP-015). La hoja `Tramos` queda CONGELADA: es el origen del que se
-- importa una vez, no una fuente que se siga editando.
--
-- QUE NO SE PUDO MEJORAR AL MIGRAR, Y SE DICE. `Ultima modificacion` en la hoja es
-- una CELDA DE TEXTO, no una fecha: la escribe Utilities.formatDate pero nadie la
-- tipifica, y puede tener texto libre. Por eso hay dos columnas y no una:
--   actualizado      el texto tal cual, que es lo que la tabla de Catálogos
--                    muestra hoy. Migrarlo a timestamptz habria cambiado lo que se
--                    ve en pantalla sin que nadie lo pidiera.
--   actualizado_at   el instante, solo si el texto se pudo leer como fecha. Es
--                    para ordenar y auditar; NULO cuando la celda no era fecha, y
--                    NULO no se rellena de inventado.
--
-- COMO SE APLICA. Requiere SUPABASE_DB_PASSWORD. El envoltorio la pide en un
-- prompt oculto y la pasa solo por memoria:
--
--   powershell -NoProfile -File scripts\apply-sql-supabase.ps1
--
-- Es IDEMPOTENTE: create table if not exists + create index if not exists, y
-- `on conflict ... do nothing` en la parte de datos. CREAR LA TABLA NO MUEVE LOS
-- DATOS: despues hay que correr PP_migrarTramosASupabase_ una vez desde el editor
-- de Apps Script.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. inspection_routes: un tramo por (Articulo, Materia prima)
-- ----------------------------------------------------------------------------
create table if not exists public.inspection_routes (
  id             uuid primary key default gen_random_uuid(),
  clave          text not null,
  articulo       text not null,
  -- El dibujo a nivel OT se guarda con el material VACIO: asi lo usa
  -- PP_Inspection_articleDrawingMatchV2_ (17-inspection-drawing-service.js:103),
  -- que busca la clave articulo + '|' sin material. Por eso NO es not null sin
  -- default: la fila de dibujo de la OT es una fila mas y no un caso aparte.
  material       text not null default '',
  tramo          text not null default '',
  dibujo         text not null default '',
  actualizado    text not null default '',
  actualizado_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.inspection_routes is
  'Catalogo de TRAMOS Y DIBUJOS de inspeccion. Dato MANUAL: lo escribe la pagina '
  '(PPSupabaseWriter.guardarInspectionRoute), un solo escritor. Migrado de la hoja '
  '`Tramos` del libro INSPECTION_SPREADSHEET_ID, que queda congelada. Antes la web lo '
  'leia de `materials`, que es tabla del ERP y no tiene columna de tramo.';

comment on column public.inspection_routes.clave is
  'Clave natural: PP_normalizeKey_(articulo) + ''|'' + PP_normalizeKey_(material). '
  'Es el indice unico y la columna del on_conflict del escritor. Un ARTICULO con '
  'material vacio es el dibujo a nivel de orden de trabajo, no un tramo.';

comment on column public.inspection_routes.tramo is
  'Texto del tramo de inspeccion, tal cual lo escribe la persona ("600 MM", "102 MM (PARA 2 PIEZAS)"). No es un numero: se mide en la hoja, no en la base.';

comment on column public.inspection_routes.dibujo is
  'Dibujo o liga del archivo. Libre: puede ser una ruta de red, un id de Drive o un texto. Se limpia de comillas en el lector (PP_Inspection_cleanDrawing_), no al guardar.';

comment on column public.inspection_routes.actualizado is
  'Texto de "Ultima modificacion" de la hoja, VERBATIM. Es lo que la tabla de Catalogos muestra y por eso no se convierte a fecha: la hoja lo guarda como texto.';

comment on column public.inspection_routes.actualizado_at is
  'Instante de la ultima modificacion, NULL si el texto de la hoja no se pudo leer como fecha. Sirve para ordenar y auditar; no se inventa cuando no se sabe.';

-- Un tramo por par articulo/material. Sin este indice el UPSERT del escritor
-- resuelve contra el PRIMARY KEY (uuid) y cada guardado crearia una fila nueva.
create unique index if not exists inspection_routes_clave_uniq
  on public.inspection_routes (clave);

-- El mismo indice pero de solo lectura para el servidor: la hoja de inspeccion
-- busca por articulo y la pagina lista y filtra por el mismo campo.
create index if not exists inspection_routes_articulo_idx
  on public.inspection_routes (articulo);

-- ----------------------------------------------------------------------------
-- 2. RLS: mismo patron que machine_catalog (docs/schema-machine-catalog.sql).
--    DROP + CREATE y no `create policy if not exists`, que PostgreSQL NO tiene
--    (RULE-SUP-037: lo que se aplica es lo que dice el archivo, no lo que se
--    recuerda de el).
-- ----------------------------------------------------------------------------
alter table public.inspection_routes enable row level security;

-- MEDIDO 2026-10-01 en las demas tablas de catalogo: con la clave publica y sin
-- sesion la Data API responde HTTP 200 con CERO filas, no un error. Un catalogo
-- que se lee "vacio" sin decir por que es la peor falla posible, asi que la
-- lectura exige sesion, como el resto.
drop policy if exists lectura_web on public.inspection_routes;
drop policy if exists inspection_routes_select_authenticated on public.inspection_routes;
create policy inspection_routes_select_authenticated
  on public.inspection_routes for select
  to authenticated
  using (true);

-- Escritura: la pagina, con el JWT. NO se abre a anon (RULE-SUP-015).
drop policy if exists inspection_routes_write_authenticated on public.inspection_routes;
create policy inspection_routes_write_authenticated
  on public.inspection_routes for all
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- 3. ingestion_mirror: admitir la tabla para el importador.
--
-- POR QUE ESTA TABLA Y NO LA LISTA DEL CUERPO. La funcion public.ingesta_mirror
-- valida p_tabla contra public.ingesta_mirror_whitelist, que es una TABLA
-- (docs/schema-supabase-plan.sql:233 y :324), no contra un array metido en el
-- cuerpo. Por eso agregar una tabla es insertar una fila y no reescribir la
-- funcion: la version que aun tiene la lista en el cuerpo es ingesta_mirror_v1.
--
-- OJO CON LO QUE ES ESTE RPC. Es BORRA-E-INSERTA. El importador lo usa UNA vez
-- para volcar la hoja; si se corre DESPUES de que la pagina empiece a editar
-- tramos, devuelve la tabla al estado de la hoja y se pierde lo capturado. Por eso
-- NO hay boton en la pagina, y no es una omision: un boton seria un segundo
-- servicio del mismo dato (borraria el trabajo de quien esta capturando) y dejaria
-- el resultado en manos de quien pulse. La fila se queda en la whitelist porque el
-- importador corre MANUALMENTE desde el editor de Apps Script, una vez, y desde
-- ahi si se puede decir que es una importacion y no un guardado.
-- ----------------------------------------------------------------------------
insert into public.ingesta_mirror_whitelist (tabla, nota) values
  ('inspection_routes', 'tramos de inspeccion migrados de la hoja Tramos; el escritor de la pagina NO usa este RPC')
on conflict (tabla) do update set nota = excluded.nota;

-- ----------------------------------------------------------------------------
-- 4. DISPARADOR de updated_at: mismo patron que el resto de catalogos.
-- ----------------------------------------------------------------------------
create or replace function public.pp_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inspection_routes_set_updated_at on public.inspection_routes;
create trigger inspection_routes_set_updated_at
  before update on public.inspection_routes
  for each row execute function public.pp_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. LO QUE ESTE ARCHIVO NO HACE, DICHO.
--
-- No copia los datos. Los datos estan en Google Sheets y este DDL no tiene
-- acceso a Drive: el volcado lo hace PP_migrarTramosASupabase_
-- (16-inspection-service.js), que lee la hoja `Tramos` y llama
-- public.ingesta_mirror con p_tabla = 'inspection_routes'. Correlo UNA vez desde
-- el editor de Apps Script despues de aplicar este archivo.
--
-- No borra la hoja `Tramos`. Se congela: queda como respaldo de lo que habia, y
-- su historico es la unica forma de recuperar una fila que alguien borre por
-- error en la pagina (la tabla no tiene borrado; ver la nota de borrado de
-- supabase-writer.js).
--
-- No toca `materials`. La web leia los tramos de ahi, lo cual era un error de
-- origen, no una lectura: `materials` la escribe el RESTlet 2246 cada 15 minutos
-- y no tiene columna de tramo. Las filas que la pagina guardo ahi con
-- `dibujo: route` (guardarCatalogos via guardarPlan) no se traen: eran un valor
-- mal escrito, no un tramo.
-- ----------------------------------------------------------------------------
