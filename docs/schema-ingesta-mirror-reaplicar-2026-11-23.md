# Incidente 2026-11-23: la ingesta dejó de escribir `ensambles_ot`

## Síntoma

El reporte **Liberación real** se quedó congelado en el **12/11/2026** (631 ensambles visibles)
mientras el resto del espejo sí se actualizaba. Al pulsar "Sincronizar datos" salía:

```
Ingesta a medias: escribieron 7 tablas, 0 quedaron vacías y 1 conservan lo anterior.
work_orders: 501 filas | operations: 2207 | materials: 322 | items: 2986 |
machines: 203 | inventory: 1985 | sales_orders: 133
CON LO ANTERIOR (no se pudo vaciar): ensambles_ot
  (Supabase rpc ingesta_mirror ensambles_ot 400: codigo P0001 |
   ingesta_mirror: tabla no permitida: ensambles_ot)
ERRORES: ensambles_ot: ERROR al escribir: ... tabla no permitida: ensambles_ot
```

## Causa raíz

La función `public.ingesta_mirror` **desplegada** no era la canónica: tenía la lista de tablas
metida en el cuerpo (la versión de `docs/schema-supabase-cierre-catalogos.sql`, sección 7), que no
incluye `ensambles_ot`. La fila de la whitelist no se consultaba.

La firma del mensaje lo delata: la versión con lista fija lanza

```
raise exception 'ingesta_mirror: tabla no permitida: %', p_tabla;
```

y la canónica agrega el paréntesis `(la lista es public.ingesta_mirror_whitelist)`. El error que
llegó a la página **no** traía el paréntesis.

Es el mismo patrón que RULE-SUP-038 ya documenta: `create or replace` no avisa cuando pisa una
versión anterior, así que el síntoma "tabla no permitida" se lee dos veces — ¿falta la fila en la
whitelist? y ¿la función desplegada lee la whitelist o tiene su propia lista? Lo segundo se mide
con `pg_get_functiondef`, nunca leyendo el repo.

## Medición

```sql
select pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'ingesta_mirror';
```

Antes: 3,157 bytes, sin `ingesta_mirror_whitelist` en el cuerpo.
Después: 4,833 bytes, con la consulta a `public.ingesta_mirror_whitelist`.

## Arreglo aplicado (2026-11-23)

1. Se reaplicó la función canónica completa de `docs/rpc-ingesta-mirror.sql` (sección 3) más sus
   `revoke`/`grant` (sección 4).
2. Se aseguró la fila de la tabla en la whitelist:

```sql
insert into public.ingesta_mirror_whitelist (tabla, nota)
values ('ensambles_ot', 'espejo de NetSuite: eventos de ensamblado de la planta 1 (RULE-SUP-078)')
on conflict (tabla) do update set nota = excluded.nota;
```

## Verificación

Ingesta completa forzada (`POST` al web app con `{ accion: "ingesta", forzado: true }`):

```
ok: true | filas: work_orders 501, operations 2207, materials 322, items 2988,
machines 203, inventory 1990, sales_orders 133, ensambles_ot 671
vaciadas: [] | noSePudoVaciar: [] | errores: []
```

```sql
select count(*) as filas, max(fecha) as ultima_fecha, max(updated_at) as ultimo_escrito
  from public.ensambles_ot;
-- 671 | 2026-11-23 | 2026-11-23 20:16:19Z
```

## Regla para la próxima vez

Si una tabla del espejo deja de actualizarse y el resto sí, **primero** medir la función con
`pg_get_functiondef`. Si el cuerpo no menciona `ingesta_mirror_whitelist`, reaplicar
`docs/rpc-ingesta-mirror.sql`; el INSERT en la whitelist por sí solo no arregla nada en ese caso.
