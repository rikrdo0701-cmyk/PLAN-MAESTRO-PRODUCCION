# Hoja de inspección: botón Sincronizar (2026-11-25)

## Qué resuelve

La hoja de inspección mostraba datos viejos y la única forma de traer cambios de NetSuite era
salir a Plan semanal y pulsar **Sincronizar**. Ahora hay un botón **Sincronizar OTs** dentro de la
propia hoja que hace las dos cosas que hacían falta, en este orden:

1. Dispara la ingesta forzada de Apps Script (`PPIngestaTrigger.dispararIngesta`), **solo** con las
   acciones `workorders` y `operaciones`:
   ```js
   { forzado: true, solo: ["workorders", "operaciones"] }
   ```
   `PP_ingesta_` respeta esa lista y, por RULE-SUP-048 (excepción "tabla no pedida ≠ tabla que
   falló"), no vacía ni toca `materials`, `items`, `inventory`, `sales_orders`, `machines` ni
   `ensambles_ot`. Es la misma puerta que usan los botones del plan, acotada a las dos tablas.
2. Limpia `bundleCache`, vuelve a leer `work_orders` (`getInspectionWorkOrders`) y recarga la hoja
   de la OT seleccionada con `forceRefresh: true` (operaciones incluidas).

Alcance deliberado: este botón no actualiza el BOM (`materials`), artículos ni inventario. Para eso
sigue estando el **Sincronizar** completo de Plan semanal. Lo que sí trae es OT nueva, artículo,
cantidad y operaciones, que es lo que pedía la persona el 2026-11-25.

## Por qué un botón que solo releyera no sirve

La página **nunca** habla con NetSuite (RULE-SUP-030). Todo sale del espejo en Supabase, y el
espejo solo se reescribe cuando corre la ingesta:

- Activa por reloj cada 15 min, **solo de lunes a viernes de 7:00 a 17:00**
  (`src/server/19-appscript-ingesta-supabase.js`, guard de `PP_ingesta_`).
- El activador se instala a mano una vez (`PP_crestaTriggerIngesta_()`) y no se puede crear desde
  fuera de Apps Script.
- El botón manda `forzado: true`, que salta ese filtro. Por eso funciona a cualquier hora.

Una relectura sin ingesta devuelve exactamente lo mismo: una OT nueva o un material corregido en
NetSuite no existe en el espejo hasta que la ingesta lo escribe.

## Medición que originó el cambio (2026-11-25 20:17 local)

| Tabla | Filas | Última escritura |
|---|---|---|
| `work_orders` | 422 | 25/11 17:34:53 local (23:34 UTC) |
| `operations` | 1.411 | 25/11 17:34:55 |
| `app_state.synced_at` | — | 25/11 17:34:58 |

`ingesta_mirror` borra y reinserta la tabla completa, así que todas las filas comparten la marca
de la última ingesta. Esa escritura es posterior al corte de las 17:00: fue forzada por el botón,
no por el activador. No hubo ninguna escritura programada después.

## Restricciones

- El botón no crea un segundo escritor: reutiliza la ingesta existente, que sigue siendo el único
  camino de NetSuite a Supabase.
- Si la ingesta responde `motivo: "ocupada"` (ya hay una corrida), no se falla: se relee el espejo
  y se avisa que la corrida no se completó.
- Si el build no trae `PPIngestaTrigger`, se relee Supabase y el aviso lo dice.
- La hoja sigue cacheando cada OT 5 minutos (`INSPECTION_CACHE_TTL_MS`); el botón limpia ese caché.

## Piso de latencia

Sigue siendo `intervalo de ingesta + relectura`. Para bajarlo habría que reducir
`PP_INGESTA_CADA_MINUTOS_`, ampliar la ventana horaria, o que NetSuite empuje al guardar (User
Event), que es otro proyecto.
