-- =============================================================================
-- CATALOGO DE MAQUINAS MANUAL
--
-- POR QUE ESTA TABLA. DECISION DEL USUARIO 2026-10-01: el catalogo de maquinas
-- es un dato MANUAL (la pagina lo escribe), no informacion de ingesta. Hoy la
-- tabla `machines` la escribe el RESTlet 2246 desde NetSuite (entitygroup) cada
-- 15 minutos, y la pagina la lee. Eso hace que el catalogo de maquinas dependa
-- de la ingesta, y el usuario quiere que no sea asi.
--
-- QUE CAMBIA. La fuente del catalogo de maquinas pasa de `machines` (ingesta)
-- a `machine_catalog` (manual). La pagina es la UNICA escritora de
-- `machine_catalog` (guardarCatalogos), y la ingesta deja de escribir el
-- catalogo de maquinas.
--
-- QUE NO CAMBIA. `machine_planning_overrides` sigue siendo la tabla de maquinas
-- APARTADAS (RULE-SUP-017): la planificacion solo puede apartar, no forzar el
-- uso. `machine_catalog` es el listado; `machine_planning_overrides` es la
-- decision de no agendar en una de ellas.
--
-- COMO SE APLICA. Requiere SUPABASE_DB_PASSWORD. El envoltorio la pide en un
-- prompt oculto y la pasa solo por memoria:
--
--   powershell -NoProfile -File scripts\apply-sql-supabase.ps1
--
-- Es IDEMPOTENTE: create table if not exists + create index if not exists.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. machine_catalog: el catalogo de maquinas, escrito por la pagina
-- ----------------------------------------------------------------------------
create table if not exists public.machine_catalog (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.machine_catalog is
  'Catalogo de MAQUINAS. Dato MANUAL: lo escribe la pagina (guardarCatalogos), no la ingesta. '
  'Antes este catalogo vivia en `machines`, que el RESTlet 2246 escribia desde NetSuite; '
  'la decision 2026-10-01 lo movio a una tabla que la pagina es la unica dueña.';

comment on column public.machine_catalog.nombre is
  'Nombre de la maquina. Es la clave con la que se programa (unico).';

comment on column public.machine_catalog.activa is
  'Maquina disponible para programar. La planificacion la lee con activa = true.';

-- Un solo nombre de maquina: el catalogo no puede tener duplicados.
create unique index if not exists machine_catalog_nombre_uniq
  on public.machine_catalog (nombre);

-- ----------------------------------------------------------------------------
-- 2. RLS: la pagina escribe (service role), el lector anon/authenticated lee.
--    Mismo patron que las demas tablas de catalogo.
-- ----------------------------------------------------------------------------
alter table public.machine_catalog enable row level security;

-- MEDIDO 2026-10-01: la primera version de este archivo decia `create policy if not exists`,
-- y PostgreSQL lo rechaza: CREATE POLICY NO tiene forma IF NOT EXISTS. La corrida del
-- 2026-10-01 lo devolvio tal cual: `ERROR: syntax error at or near "not"`. El DDL entero no
-- se aplico (Postgres se detiene en el primer error de un lote), asi que la tabla tampoco.
--
-- El patron idempotente es el de los otros DDL del repo (schema-supabase-cierre-catalogos.sql:
-- "drop policy de los DOS nombres antes del create"): DROP y CREATE, no IF NOT EXISTS. Asi
-- tambien queda el estado ACTUAL de la base y no el que conocia cuando se escribio
-- (RULE-SUP-037): si alguien cambio la politica a mano, aplicar este archivo la deja como
-- dice aqui en vez de saltarsela en silencio.
--
-- Lectura: las tablas de catalogo se leen con sesion. `machines`, `operators` y `matrix` dan
-- 0 filas con la clave publica y sin sesion (medido 2026-10-01), y machine_catalog debe
-- comportarse igual: el catalogo de maquinas no es un dato publico.
drop policy if exists lectura_web on public.machine_catalog;
drop policy if exists machine_catalog_select_authenticated on public.machine_catalog;
create policy machine_catalog_select_authenticated
  on public.machine_catalog for select
  to authenticated
  using (true);

-- Escritura: la pagina escribe con el JWT (authenticated), igual que las demas tablas de
-- catalogo que ya tienen escritura para ese rol. NO se abre a anon: con el bundle de Pages
-- alguien podria agregar o quitar maquinas sin entrar (RULE-SUP-015).
drop policy if exists machine_catalog_write_authenticated on public.machine_catalog;
create policy machine_catalog_write_authenticated
  on public.machine_catalog for all
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- 3. MIGRACION: copiar las maquinas que ya existen en `machines` (NetSuite)
--    a `machine_catalog`, para no perder el catalogo que ya esta en uso.
--    Se hace con un INSERT ... SELECT que no pisa las que ya existen.
-- ----------------------------------------------------------------------------
insert into public.machine_catalog (nombre, activa)
select m.nombre, coalesce(m.activa, true)
from public.machines m
on conflict (nombre) do nothing;

-- ----------------------------------------------------------------------------
-- 4. DISPARADOR de updated_at: mismo patron que las otras tablas de catalogo.
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

drop trigger if exists machine_catalog_set_updated_at on public.machine_catalog;
create trigger machine_catalog_set_updated_at
  before update on public.machine_catalog
  for each row execute function public.pp_set_updated_at();
