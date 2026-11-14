-- ============================================================================
-- DELTA 2026-11-13: plan_snapshots LIGERO Y CON RETENCION DE 5
--
-- QUE ARREGLA (medido, no supuesto). MEDIDO 2026-11-13 contra la base de
-- produccion (xtgtfjcwxcoxvixholpj) con un JWT REAL de rol `authenticated`:
--
--   * La lista de instantaneas pedia `select=*`, o sea el `payload` jsonb de las
--     14 filas: 50.443.992 bytes de JSON y 5.8-7 s POR PETICION sola.
--   * El rol `authenticated` tiene `statement_timeout = 8 s`. Con el arranque
--     normal de la pagina encima (esta lista se lanza junto con los catalogos y
--     el borrador) cruzaba el limite y PostgREST devolvia HTTP 500:
--     {"code":"57014",...,"message":"canceling statement due to statement timeout"}
--     Reproducido: 6 peticiones simultaneas -> 6 de 6 en HTTP 500. Ese es el
--     error que dejaba el plan sin cargar.
--   * Empeora solo: cada publicacion agrega ~5 MB de payload.
--
-- QUE HACE
--
-- (1) `operations_count` GENERADA. El conteo de operaciones que la lista y el
--     selector de planes necesitan, sin abrir el payload. Postgres la mantiene
--     en cada escritura, asi que vale para los DOS escritores (el RPC
--     `plan_guardar` y el UPSERT directo del navegador) sin tocar ninguno.
--     STORED porque Postgres no tiene columnas generadas virtuales.
--
-- (2) Indice por `created_at`: es el orden de la lista y el de la retencion.
--
-- (3) Relleno de `plan_start`. MEDIDO: 13 de 14 filas lo tenian VACIO porque
--     ningun escritor lo mandaba (la semana vivia solo dentro del payload). Si
--     la lista deja de leer el payload, sin este relleno se pierden la etiqueta
--     de "inicio" del selector de planes y la version por semana. El escritor
--     ahora manda la columna (supabase-writer.js, guardarPlanSnapshot).
--
-- (4) RETENCION DE 5 (pedido del usuario 2026-11-13): al insertar una
--     instantanea nueva se borran las mas viejas y quedan como maximo 5.
--     NUNCA se borra la fila `draft`: es el plan de trabajo y RULE-PLAN-013 dice
--     que el borrador es su autoridad; borrarlo perderia el trabajo de la
--     persona. O sea: `draft` + las 5 publicadas/guardadas mas nuevas.
--     Va en un TRIGGER y no en la pagina porque asi la regla vale por los DOS
--     caminos de escritura (el RPC `plan_guardar` y el POST del navegador), y
--     porque `authenticated` no tiene DELETE sobre la tabla y no debe tenerlo:
--     la unica forma de borrar filas es esta regla.
--     SECURITY DEFINER a proposito: el trigger borra como dueno de la tabla, no
--     como el rol que inserto. `search_path` fijo para que la funcion no dependa
--     del search_path de quien la dispara.
--     Es un trigger de funcion de trigger: Postgres no deja invocarla con un
--     SELECT ("trigger functions can only be called as triggers"), asi que no
--     hace falta tocarle los GRANT.
--
-- COMO SE APLICA (una vez; las sentencias son idempotentes):
--   $env:SUPABASE_ACCESS_TOKEN = (Get-Clipboard -Raw).Trim()   # token sbp_, nunca en el repo
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-11-13.sql --diagnosticar
--   node scripts/aplicar-ddl.mjs docs/schema-supabase-plan-delta-2026-11-13.sql
--   Remove-Item Env:SUPABASE_ACCESS_TOKEN
--
-- COMO SE COMPRUEBA
--   * `select operations_count from public.plan_snapshots order by created_at desc`
--     da el mismo numero que `jsonb_array_length(payload->'operations')`.
--   * `select count(*) from public.plan_snapshots` queda en 6: `draft` + 5.
--   * la lista (`GET /rest/v1/plan_snapshots?select=<columnas>&order=created_at.desc`)
--     devuelve ~1 KB en menos de 100 ms.
-- ============================================================================

alter table public.plan_snapshots
  add column if not exists operations_count integer
  generated always as (
    case when jsonb_typeof(payload -> 'operations') = 'array'
         then jsonb_array_length(payload -> 'operations')
         else 0 end
  ) stored;

comment on column public.plan_snapshots.operations_count is
  'Cuantas operaciones trae payload->operations. GENERADA por Postgres (no se escribe a mano): la lista de instantaneas la lee para no traerse el payload, que son 50 MB medidos el 2026-11-13.';

create index if not exists plan_snapshots_created_at_desc_idx
  on public.plan_snapshots (created_at desc nulls last);

update public.plan_snapshots
   set plan_start = coalesce(
         nullif(btrim(coalesce(payload ->> 'planStart', '')), ''),
         nullif(btrim(coalesce(payload ->> 'weekStart', '')), ''),
         ''
       )
 where coalesce(btrim(plan_start), '') = '';

create or replace function public.plan_snapshots_conservar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conservar constant integer := 5;
begin
  delete from public.plan_snapshots
   where id in (
     select ranking.id
       from (
         select id,
                row_number() over (order by created_at desc nulls last, id desc) as posicion
           from public.plan_snapshots
          where snapshot_id <> 'draft'
       ) ranking
      where ranking.posicion > v_conservar
   );
  return null;
end;
$$;

comment on function public.plan_snapshots_conservar() is
  'Retencion de plan_snapshots (2026-11-13): conserva la fila draft y las 5 instantaneas mas nuevas, y borra el resto. Corre despues de cada insert. La fila draft NUNCA se borra: es el plan de trabajo (RULE-PLAN-013).';

drop trigger if exists plan_snapshots_conservar on public.plan_snapshots;

create trigger plan_snapshots_conservar
after insert on public.plan_snapshots
for each row execute function public.plan_snapshots_conservar();

-- Limpieza de una vez: hoy hay 8 instantaneas guardadas de mas (14 filas, 1 es draft).
delete from public.plan_snapshots
 where id in (
   select ranking.id
     from (
       select id,
              row_number() over (order by created_at desc nulls last, id desc) as posicion
         from public.plan_snapshots
        where snapshot_id <> 'draft'
     ) ranking
    where ranking.posicion > 5
 );
