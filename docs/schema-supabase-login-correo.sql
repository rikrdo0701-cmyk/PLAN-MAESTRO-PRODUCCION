-- ============================================================================
-- Login con correo: la pagina deja de ser publica y la escritura sale del
-- navegador con sesion.
--
-- POR QUE ESTE ARCHIVO. 2026-09-29. El proyecto paso de "sin login" a "login con
-- correo" porque la lectura ya era publica para cualquiera (MEDIDO: la clave
-- publicable esta en el bundle de GitHub Pages y las 25 tablas tienen politica
-- `select to anon using true`, o sea que sin sesion se leen enteras). Con login,
-- la pagina pide correo y contrasena a Supabase, recibe un JWT, y RLS solo deja
-- pasar a quien tiene sesion. Eso cierra la lectura Y legitimiza la escritura
-- directa desde el navegador, que era el objetivo del usuario (RULE-SUP-019).
--
-- QUE SE CAMBIA Y QUE NO.
--   ANTES: select to anon using true   -> cualquiera, sin sesion, leia las 25.
--   AHORA: select to authenticated      -> solo quien entro con correo.
--   Las tablas que escribe la ingesta de NetSuite (7) y el espejo de catalogos
--   siguen escribiendose por service_role, que salta RLS. Este archivo NO les da
--   escritura a la pagina: no deben de tenerla todavia (RULE-SUP-015).
--
-- POR QUE ES DIFICIL DE LEER AL REVES. Un `drop policy` sin el `create` que va
-- detras deja la tabla sin ninguna politica de lectura: no es que se evite el
-- acceso, es que la siguiente linea vuelve a abrirlo o lo cierra por accidente.
-- Por eso cada par va junto y con el motivo escrito al lado.
--
-- QUE NO HACE ESTE ARCHIVO, Y HAY QUE HACER APARTE. El proveedor de correo de
-- Supabase Auth y las cuentas de las personas que planifican. Las cuentas se
-- pueden crear por la Admin API con la service role key, sin este DDL; el
-- proveedor se enciende en el panel (Authentication -> Sign In / Providers).
--
-- ESTADO: ESCRITO, NO APLICADO. Se aplica con
--   powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1 -Si -Teclado
-- La contrasena se teclea en el prompt enmascarado: no va en un comando ni en el
-- historial. Pide rotar la actual primero, que esta escrita en el chat.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Las 7 tablas de ingesta de NetSuite: la pagina las LEE, no las escribe.
--    RLS con authenticated: sin sesion no se ven, que es lo que pedia el
--    usuario al poner una contraseña.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'work_orders',
    'operations',
    'materials',
    'items',
    'machines',
    'inventory',
    'sales_orders',
    'capabilities',
    'operation_catalog',
    'matrix',
    'operators',
    'ot_types',
    'calendar_exceptions',
    'article_configurations',
    'ot_configurations',
    'tools',
    'subcontracts',
    'machine_planning_overrides'
  ] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'lectura_web') then
      execute format('drop policy lectura_web on public.%I', t);
    end if;
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'work_orders',
    'operations',
    'materials',
    'items',
    'machines',
    'inventory',
    'sales_orders',
    'capabilities',
    'operation_catalog',
    'matrix',
    'operators',
    'ot_types',
    'calendar_exceptions',
    'article_configurations',
    'ot_configurations',
    'tools',
    'subcontracts',
    'machine_planning_overrides'
  ] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'lectura_app') then
      execute format('create policy "lectura_app" on public.%I for select to authenticated using (true)', t);
    end if;
  end loop;
end $$;
do $$
declare
  t text;
begin
  foreach t in array array[
    'capabilities',
    'operation_catalog',
    'matrix',
    'operators',
    'ot_types',
    'calendar_exceptions',
    'article_configurations',
    'ot_configurations',
    'tools',
    'subcontracts',
    'machine_planning_overrides'
  ] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'escritura_app') then
      execute format('create policy "escritura_app" on public.%I for select to authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Los 11 catalogos: lectura Y escritura desde la pagina, con sesion.
--    Se separan lectura y escritura a proposito: asi se puede abrir la lectura
--    antes que la escritura sin tocar dos veces, y queda escrito en el DDL que
--    la escritura existe en vez de heredarse de una politica generica.
-- ----------------------------------------------------------------------------


-- Escritura de catalogos. for all = insert, update y delete con la misma regla,
-- que es lo que necesita un editor de catalogo: agrega, corrige y borra filas.
-- SIN `with check` no habria nada que impedir: RLS con USING filtra lo que se lee
-- pero, sin WITH CHECK, no filtra lo que se ESCRIBE. Un delete sin with check
-- permitiria borrar filas que la propia politica de lectura dejaria ver. Con
-- using (true) and with check (true) la condicion es explicita y no depende de
-- que RLS rellene lo que falte.

-- ----------------------------------------------------------------------------
-- 3. Lo que el RESTlet escribe y la pagina todavia no: la page la lee con sesion
--    y no la escribe. Se dejan SIN politica de escritura a proposito. Anotarlo es
--    la mitad del trabajo: dentro de un mes alguien va a querer guardar el plan
--    desde la pagina y tiene que ver aqui que la decision fue deliberada.
-- ----------------------------------------------------------------------------
-- app_state, selected_ots, locked_ots, operation_plan_statuses, plan_snapshots:
--   sigue la INGESTA y la pagina; su escritura directa es el paso 4 de
--   RULE-SUP-020 y no se abre aqui.

-- ----------------------------------------------------------------------------
-- 4. El RPC de espejo: ni anon ni authenticated lo ejecutan. Escribe con service
--    role, que es Apps Script y la ingesta. Se mantiene el revoke de las tres
--    statements anteriores, solo que ahora se hace explicito para authenticated
--    tambien, por si alguien lo concedio alguna vez por descuido.
-- ----------------------------------------------------------------------------
revoke execute on function public.ingesta_mirror(text, jsonb) from anon;
revoke execute on function public.ingesta_mirror(text, jsonb) from authenticated;
revoke execute on function public.ingesta_mirror(text, jsonb) from public;
grant execute on function public.ingesta_mirror(text, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Comprobaciones de lectura. Se dejan para el final a proposito: si algo
--    fallo arriba, estas lo dicen antes de que nadie Celebre un exito falso.
--    Las ejecuta el mismo DDL, no hace falta abrir nada.
-- ----------------------------------------------------------------------------
do $$
declare
  abierto text;
  conSesion integer;
begin
  -- Debe salir VACIO: ninguna tabla puede seguir con una politica para anon.
  select string_agg(distinct tablename, ', ')
    into abierto
    from pg_policies
   where schemaname = 'public'
     and policyname = 'lectura_web';
  if abierto is not null then
    raise exception 'QUEDAN POLITICAS lectura_web (abiertas a anon) en: %', abierto;
  end if;

  -- Debe salir 18: 7 de ingesta + 11 de catalogos, solo para authenticated.
  select count(*) into conSesion
    from pg_policies
   where schemaname = 'public'
     and policyname = 'lectura_app'
     and tablename in (
       'work_orders', 'operations', 'materials', 'items', 'machines', 'inventory', 'sales_orders',
       'capabilities', 'operation_catalog', 'matrix', 'operators', 'ot_types', 'calendar_exceptions',
       'article_configurations', 'ot_configurations', 'tools', 'subcontracts', 'machine_planning_overrides'
     )
     and roles = array['authenticated']::name[];
  if conSesion <> 18 then
    raise exception 'FALTAN POLITICAS lectura_app: hay %, se esperaban 18', conSesion;
  end if;
end $$;
