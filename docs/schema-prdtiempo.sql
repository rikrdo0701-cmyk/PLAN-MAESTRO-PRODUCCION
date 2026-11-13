-- =============================================================================
-- PRDTIEMPO: REGISTRO DE INICIO Y FIN DE OPERACION DESDE EL TELEFONO
--
-- POR QUE EXISTE ESTA TABLA. La pagina /prd.html (telefono del piso, camara
-- siempre encendida) lee el codigo Code 128 de la OT y registra cuando empieza y
-- cuando termina una operacion, con el ciclo por pieza en minutos. Ese registro
-- NO vive en `operations`: esa tabla la escribe la ingesta de NetSuite (RESTlet
-- 2246) y la siguiente sincronizacion borraria el dato. Es una tabla aparte y su
-- unico escritor son las funciones de este archivo.
--
-- POR QUE UNA FILA POR OT + OPERACION, Y NO UNA POR OT. Una OT puede tener dos
-- operaciones corriendo al mismo tiempo (dos maquinas, dos personas). El registro
-- abierto se identifica por el par (ot, operacion_id) y hay un indice unico
-- parcial que impide dos abiertos del mismo par. Al finalizar se completa la
-- MISMA fila (hora_fin, cantidad, tiempo_ciclo_min); no se inserta otra.
--
-- POR QUE NO HAY POLITICAS DE RLS. La pagina todavia no tiene login (decision del
-- usuario 2026-11-11; el login por codigo de barras viene en una etapa posterior).
-- Si la tabla tuviera una politica para `anon`, cualquiera con el enlace podria
-- leer y escribir CUALQUIER fila, incluido borrar. En cambio, la tabla no se
-- expone: no hay politicas, se revocan los permisos de tabla y la pagina solo
-- puede llamar tres funciones SECURITY DEFINER con parametros acotados. La
-- consecuencia que si queda y hay que decir: el enlace es publico, asi que
-- cualquiera que lo abra puede iniciar o finalizar corridas de OTs reales. Las
-- funciones reducen el dano (solo OTs existentes, sin borrados, una corrida
-- abierta por par y operacion que debe existir), pero no identifican a la
-- persona. Eso lo resuelve la etapa del login.
--
-- HORA: la manda el telefono (decision del usuario). No se guarda una copia de la
-- hora del servidor en la fila, pero `prdtiempo_escanear` devuelve
-- `servidor_ahora` para que la pagina pueda avisar de un reloj desfasado sin
-- cambiar el esquema.
--
-- COMPLETAR OPERACIONES DEL PLAN: en esta etapa NO se toca `operations` (decision
-- del usuario). El registro guarda `operacion_id`, `operacion_secuencia` y las
-- cantidades justamente para que la etapa siguiente pueda marcarlas como
-- completadas sin volver a capturar nada.
--
-- IDEMPOTENTE: se puede correr dos veces. `create table/index if not exists`,
-- `create or replace function`, y `drop trigger if exists` antes del trigger.
--
-- COMPROBACION RAPIDA DESPUES DE APLICARLO (SQL editor de Supabase):
--   select public.prdtiempo_escanear('3608');
--   select public.prdtiempo_escanear('0000');   -- no_encontrada
--   select public.prdtiempo_escanear('36A8');   -- ot_invalida
--
-- REQUISITO: `public.pp_set_updated_at()` ya existe (lo crea
-- docs/schema-inspection-routes.sql, aplicado antes que este archivo). Si algun
-- dia se corre en una base limpia, primero va ese DDL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La tabla.
-- -----------------------------------------------------------------------------
create table if not exists public.prdtiempo_registros (
  id                    uuid primary key default gen_random_uuid(),
  -- El folio de la OT, tal como viene en el codigo de barras (solo digitos).
  ot                    text not null,
  -- Copia del articulo y su descripcion AL MOMENTO DE INICIAR. Se copian y no se
  -- leen despues: si el espejo de NetSuite cambia el articulo de la OT, la corrida
  -- sigue diciendo con que se trabajo.
  articulo              text not null default '',
  articulo_descripcion  text not null default '',
  cantidad_ot           integer not null default 0,
  -- El id estable de la operacion (operations.operation_id, "ns-<id>").
  operacion_id          text not null,
  operacion_secuencia   integer not null default 0,
  operacion_descripcion text not null default '',
  maquina               text not null default '',
  -- Copia de operations.tiempo_ciclo al iniciar: minutos por pieza. Es el objetivo
  -- contra el que la pagina pinta verde / ambar / rojo. Se copia porque el catalogo
  -- puede cambiar y la corrida tiene que conservar contra que se comparo.
  ciclo_objetivo_min    numeric,
  -- Hora del telefono al dar "Iniciar". Es la que define el ciclo.
  hora_inicio           timestamptz not null,
  -- Se llena al dar "Finalizar". NULL = corrida abierta.
  hora_fin              timestamptz,
  -- Piezas de ESTA corrida (no el acumulado de la OT), decision del usuario.
  cantidad              integer,
  -- (hora_fin - hora_inicio) en minutos / cantidad, redondeado a 2 decimales.
  tiempo_ciclo_min      numeric,
  -- Identificador aleatorio del telefono (localStorage). No identifica a la
  -- persona; sirve para saber desde que dispositivo se capturo.
  dispositivo           text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint prdtiempo_cantidad_positiva
    check (cantidad is null or cantidad > 0),
  constraint prdtiempo_fin_coherente
    check (hora_fin is null or hora_fin >= hora_inicio),
  constraint prdtiempo_ciclo_coherente
    check (tiempo_ciclo_min is null or tiempo_ciclo_min >= 0),
  constraint prdtiempo_ot_formato
    check (ot ~ '^[0-9]{1,20}$')
);

comment on table public.prdtiempo_registros is
  'Corridas de una operacion capturadas desde /prd.html: hora de inicio, hora de fin '
  'y ciclo por pieza. Un solo escritor: las funciones prdtiempo_iniciar y '
  'prdtiempo_finalizar. NO es el estado de la operacion en el plan (operations), que '
  'escribe la ingesta de NetSuite.';

comment on column public.prdtiempo_registros.ciclo_objetivo_min is
  'Copia de operations.tiempo_ciclo (minutos por pieza) al iniciar. Objetivo contra el '
  'que se compara tiempo_ciclo_min en la pagina.';

comment on column public.prdtiempo_registros.hora_inicio is
  'Hora del TELEFONO al dar Iniciar (decision del usuario). Un reloj desfasado produce '
  'un ciclo falso; el escaneo devuelve servidor_ahora para poder detectarlo.';

comment on column public.prdtiempo_registros.tiempo_ciclo_min is
  'Minutos por pieza de esta corrida: (hora_fin - hora_inicio) / 60 / cantidad, a 2 '
  'decimales. NULL mientras la corrida esta abierta.';

-- -----------------------------------------------------------------------------
-- 2. Indices.
--
--    El UNIQUE es PARCIAL (`where hora_fin is null`): solo puede haber una corrida
--    abierta del mismo par OT + operacion. Finalizada la anterior, se puede iniciar
--    otra (retrabajo o segunda tanda), que es la decision del usuario.
-- -----------------------------------------------------------------------------
create unique index if not exists prdtiempo_abierta_unica
  on public.prdtiempo_registros (ot, operacion_id)
  where hora_fin is null;

-- El historial por OT (y el listado de abiertas) lo cubre este indice; no hace
-- falta otro sobre (ot, operacion_id): el UNIQUE parcial de arriba ya sirve para
-- esa busqueda.
create index if not exists prdtiempo_ot_idx
  on public.prdtiempo_registros (ot, hora_inicio desc);

-- -----------------------------------------------------------------------------
-- 3. Permisos: la tabla NO se expone. Sin politicas y sin grants, la Data API
--    responde vacio o 403 directo; el unico camino son las funciones de abajo.
-- -----------------------------------------------------------------------------
alter table public.prdtiempo_registros enable row level security;

revoke all on table public.prdtiempo_registros from anon;
revoke all on table public.prdtiempo_registros from authenticated;

drop trigger if exists prdtiempo_set_updated_at on public.prdtiempo_registros;
create trigger prdtiempo_set_updated_at
  before update on public.prdtiempo_registros
  for each row execute function public.pp_set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. La regla de "OT cerrada", en un solo lugar de la base.
--
--    Es la MISMA regla que `workOrderCerrada` de src/web/shared/supabase-reader.js:
--    normalizar (mayusculas, sin acentos) y buscar CERRAD / CLOSED / COMPLET /
--    CANCEL. Vive aqui porque el que decide si la OT se puede trabajar es el que
--    responde el escaneo, y la prueba tests/ddl-prdtiempo.test.mjs compara las dos
--    listas para que no se separen.
--
--    No se concede a anon: solo la usan las funciones de abajo.
-- -----------------------------------------------------------------------------
create or replace function public.prdtiempo_estatus_cerrado(p_estatus text)
returns boolean
language sql
immutable
as $fn$
  with t as (
    select upper(translate(coalesce(p_estatus, ''), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) as texto
  )
  select exists (
    select 1
    from t
    where t.texto <> ''
      and (
        position('CERRAD'  in t.texto) > 0
        or position('CLOSED'  in t.texto) > 0
        or position('COMPLET' in t.texto) > 0
        or position('CANCEL'  in t.texto) > 0
      )
  );
$fn$;

-- Desde anon/authenticated tambien: Supabase deja privilegios por omision sobre las
-- funciones de `public`, y `revoke ... from public` NO los quita. Medido 2026-11-11:
-- sin estas dos lineas la funcion salia con `anon=X` en su ACL.
revoke all on function public.prdtiempo_estatus_cerrado(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. prdtiempo_escanear: TODO lo que la pantalla necesita, en una llamada.
--
--    Devuelve {ok, ot, articulo, descripcion, cantidad, estatus, operaciones[],
--    abiertas[], servidor_ahora} o {ok:false, motivo} con motivo en
--    ot_invalida | no_encontrada | cerrada.
--
--    Una sola llamada y no tres: la pagina no puede leer las tablas, y encadenar
--    consultas en el telefono con mala senal es lo que se siente lento.
-- -----------------------------------------------------------------------------
create or replace function public.prdtiempo_escanear(p_ot text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ot          text := btrim(coalesce(p_ot, ''));
  v_wo          public.work_orders%rowtype;
  v_operaciones jsonb;
  v_abiertas    jsonb;
begin
  if v_ot !~ '^[0-9]{1,20}$' then
    return jsonb_build_object('ok', false, 'motivo', 'ot_invalida', 'ot', v_ot);
  end if;

  select * into v_wo
    from public.work_orders w
   where w.ot = v_ot
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada', 'ot', v_ot);
  end if;

  if public.prdtiempo_estatus_cerrado(v_wo.estatus) then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'cerrada',
      'ot', v_wo.ot,
      'estatus', v_wo.estatus
    );
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'operation_id', o.operation_id,
               'secuencia', o.secuencia,
               'descripcion', o.descripcion,
               'maquina', o.maquina,
               'ciclo_objetivo_min', o.tiempo_ciclo
             )
             order by o.secuencia, o.operation_id
           ),
           '[]'::jsonb
         )
    into v_operaciones
    from public.operations o
   where o.ot = v_ot;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', r.id,
               'operacion_id', r.operacion_id,
               'secuencia', r.operacion_secuencia,
               'descripcion', r.operacion_descripcion,
               'maquina', r.maquina,
               'hora_inicio', r.hora_inicio,
               'cantidad_ot', r.cantidad_ot,
               'ciclo_objetivo_min', r.ciclo_objetivo_min
             )
             order by r.hora_inicio desc
           ),
           '[]'::jsonb
         )
    into v_abiertas
    from public.prdtiempo_registros r
   where r.ot = v_ot
     and r.hora_fin is null;

  return jsonb_build_object(
    'ok', true,
    'ot', v_wo.ot,
    'articulo', v_wo.articulo,
    'descripcion', v_wo.descripcion,
    'cantidad', v_wo.cantidad,
    'estatus', v_wo.estatus,
    'operaciones', v_operaciones,
    'abiertas', v_abiertas,
    'servidor_ahora', now()
  );
end;
$fn$;

revoke all on function public.prdtiempo_escanear(text) from public;
grant execute on function public.prdtiempo_escanear(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. prdtiempo_iniciar: abre la corrida.
--
--    IDEMPOTENTE A PROPOSITO. Si dos telefonos escanean la misma OT y eligen la
--    misma operacion casi al mismo tiempo, el segundo NO crea una fila nueva:
--    recibe la que ya esta abierta (`ya_iniciada: true`). Lo garantiza el indice
--    unico parcial y el `on conflict do nothing`; el select de despues es lo que
--    devuelve la fila ganadora.
--
--    La operacion TIENE que pertenecer a la OT: no se puede iniciar una operacion
--    de otra orden escribiendo el id a mano.
-- -----------------------------------------------------------------------------
create or replace function public.prdtiempo_iniciar(
  p_ot           text,
  p_operacion_id text,
  p_hora_inicio  timestamptz,
  p_dispositivo  text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ot         text := btrim(coalesce(p_ot, ''));
  v_operacion  text := btrim(coalesce(p_operacion_id, ''));
  v_wo         public.work_orders%rowtype;
  v_op         public.operations%rowtype;
  v_existente  public.prdtiempo_registros%rowtype;
  v_nueva      public.prdtiempo_registros%rowtype;
begin
  if v_ot !~ '^[0-9]{1,20}$' then
    return jsonb_build_object('ok', false, 'motivo', 'ot_invalida');
  end if;

  if v_operacion = '' then
    return jsonb_build_object('ok', false, 'motivo', 'operacion_invalida');
  end if;

  if p_hora_inicio is null then
    return jsonb_build_object('ok', false, 'motivo', 'hora_invalida');
  end if;

  select * into v_wo
    from public.work_orders w
   where w.ot = v_ot
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada');
  end if;

  if public.prdtiempo_estatus_cerrado(v_wo.estatus) then
    return jsonb_build_object('ok', false, 'motivo', 'cerrada', 'estatus', v_wo.estatus);
  end if;

  select * into v_op
    from public.operations o
   where o.ot = v_ot
     and o.operation_id = v_operacion
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'operacion_invalida');
  end if;

  insert into public.prdtiempo_registros (
    ot, articulo, articulo_descripcion, cantidad_ot,
    operacion_id, operacion_secuencia, operacion_descripcion, maquina,
    ciclo_objetivo_min, hora_inicio, dispositivo
  )
  values (
    v_wo.ot, v_wo.articulo, v_wo.descripcion, v_wo.cantidad,
    v_op.operation_id, v_op.secuencia, v_op.descripcion, v_op.maquina,
    nullif(v_op.tiempo_ciclo, 0), p_hora_inicio, left(coalesce(p_dispositivo, ''), 80)
  )
  on conflict (ot, operacion_id) where hora_fin is null do nothing
  returning * into v_nueva;

  if v_nueva.id is not null then
    return jsonb_build_object(
      'ok', true,
      'ya_iniciada', false,
      'id', v_nueva.id,
      'hora_inicio', v_nueva.hora_inicio,
      'ciclo_objetivo_min', v_nueva.ciclo_objetivo_min
    );
  end if;

  select * into v_existente
    from public.prdtiempo_registros r
   where r.ot = v_ot
     and r.operacion_id = v_operacion
     and r.hora_fin is null
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'ya_iniciada', true,
    'id', v_existente.id,
    'hora_inicio', v_existente.hora_inicio,
    'ciclo_objetivo_min', v_existente.ciclo_objetivo_min
  );
end;
$fn$;

revoke all on function public.prdtiempo_iniciar(text, text, timestamptz, text) from public;
grant execute on function public.prdtiempo_iniciar(text, text, timestamptz, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. prdtiempo_finalizar: cierra la corrida y calcula el ciclo por pieza.
--
--    La condicion `hora_fin is null` en el UPDATE es la guarda de carrera: si dos
--    telefonos abren la misma corrida y los dos dan Finalizar, el segundo no
--    sobrescribe nada; recibe `ya_finalizada` con los datos del primero.
--
--    `p_cantidad` es entero y mayor que cero: el ciclo divide entre piezas y un 0
--    no tiene sentido. El aviso de "cantidad mayor a la de la OT" NO se valida
--    aqui: es un aviso de la pagina, no una restriccion (decision del usuario).
-- -----------------------------------------------------------------------------
create or replace function public.prdtiempo_finalizar(
  p_id       uuid,
  p_cantidad integer,
  p_hora_fin timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_fila     public.prdtiempo_registros%rowtype;
  v_actual   public.prdtiempo_registros%rowtype;
  v_ciclo    numeric;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'id_invalida');
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'cantidad_invalida');
  end if;

  if p_hora_fin is null then
    return jsonb_build_object('ok', false, 'motivo', 'hora_invalida');
  end if;

  select * into v_actual
    from public.prdtiempo_registros r
   where r.id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada');
  end if;

  if v_actual.hora_fin is not null then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'ya_finalizada',
      'cantidad', v_actual.cantidad,
      'hora_fin', v_actual.hora_fin,
      'tiempo_ciclo_min', v_actual.tiempo_ciclo_min
    );
  end if;

  if p_hora_fin < v_actual.hora_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'hora_invalida');
  end if;

  v_ciclo := round(
    (extract(epoch from (p_hora_fin - v_actual.hora_inicio)) / 60.0 / p_cantidad)::numeric,
    2
  );

  update public.prdtiempo_registros
     set hora_fin         = p_hora_fin,
         cantidad         = p_cantidad,
         tiempo_ciclo_min = v_ciclo
   where id = p_id
     and hora_fin is null
  returning * into v_fila;

  if v_fila.id is null then
    -- Otro telefono cerro la corrida entre el select y el update.
    select * into v_actual
      from public.prdtiempo_registros r
     where r.id = p_id;

    return jsonb_build_object(
      'ok', false,
      'motivo', 'ya_finalizada',
      'cantidad', v_actual.cantidad,
      'hora_fin', v_actual.hora_fin,
      'tiempo_ciclo_min', v_actual.tiempo_ciclo_min
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_fila.id,
    'ot', v_fila.ot,
    'operacion_id', v_fila.operacion_id,
    'cantidad', v_fila.cantidad,
    'hora_inicio', v_fila.hora_inicio,
    'hora_fin', v_fila.hora_fin,
    'tiempo_ciclo_min', v_fila.tiempo_ciclo_min,
    'ciclo_objetivo_min', v_fila.ciclo_objetivo_min
  );
end;
$fn$;

revoke all on function public.prdtiempo_finalizar(uuid, integer, timestamptz) from public;
grant execute on function public.prdtiempo_finalizar(uuid, integer, timestamptz) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7b. RPC DE REPORTE: prdtiempo_listar
--
-- Devuelve las corridas registradas en un rango de fechas, opcionalmente filtradas
-- por OT. La pagina skills.html la llama para mostrar y descargar el reporte.
create or replace function public.prdtiempo_listar(
  p_desde date default current_date - interval '7 days',
  p_hasta date default current_date,
  p_ot text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_result jsonb;
begin
  if p_desde > p_hasta then
    return jsonb_build_object('ok', false, 'motivo', 'rango_invalido');
  end if;

  select coalesce(jsonb_agg(
    row_to_json(r) order by r.hora_inicio desc
  ), '[]'::jsonb)
  into v_result
  from (
    select
      id,
      ot,
      articulo,
      articulo_descripcion,
      cantidad_ot,
      operacion_id,
      operacion_secuencia,
      operacion_descripcion,
      maquina,
      hora_inicio,
      hora_fin,
      cantidad,
      tiempo_ciclo_min,
      ciclo_objetivo_min,
      dispositivo,
      -- Ya que estamos calculamos la diferencia en minutos por pieza para que la
      -- pagina no tenga que repetir la formula.
      case
        when hora_fin is not null and hora_inicio is not null and cantidad > 0
          then round((extract(epoch from hora_fin - hora_inicio) / 60 / cantidad)::numeric, 2)
        else null
      end as tiempo_ciclo_min_calc,
      -- El estatus de la corrida: abierta o cerrada.
      case when hora_fin is null then 'abierta' else 'cerrada' end as estatus
    from prdtiempo_registros
    where hora_inicio >= p_desde::timestamptz
      and hora_inicio < (p_hasta + 1)::timestamptz
      and (p_ot = '' or ot = p_ot)
    order by hora_inicio desc
    limit 5000
  ) r;

  return jsonb_build_object('ok', true, 'registros', v_result);
end;
$fn$;

revoke all on function public.prdtiempo_listar(date, date, text) from public;
grant execute on function public.prdtiempo_listar(date, date, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. LO QUE ESTE ARCHIVO NO HACE, DICHO.
--
-- No toca `operations` ni `work_orders`: siguen siendo de la ingesta de NetSuite.
-- Tampoco llama a NetSuite ni a Apps Script.
--
-- No crea politicas de RLS para `anon` (ver la cabecera): la tabla no se lee ni se
-- escribe directo desde el navegador.
--
-- No mete la tabla en `public.ingesta_mirror_whitelist`: el espejo BORRA e
-- INSERTA, y estas corridas se acumulan. Un espejo las perderia.
--
-- No valida que la cantidad capturada no supere la de la OT: es un aviso de la
-- pagina y el usuario decidio que pueda guardarse.
-- =============================================================================

