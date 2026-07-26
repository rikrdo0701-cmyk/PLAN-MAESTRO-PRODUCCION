# Buscador, catálogo maestro y exclusiones de la matriz

## Objetivo

Agilizar la edición de la matriz de habilidades, permitir agregar operaciones activas aunque no aparezcan en OT actuales y excluir globalmente operaciones que no deben participar en el plan.

## Buscador

Agregar un campo `Buscar operación o CT…` en la barra superior de la matriz.

- Coincidencia parcial por nombre o CT.
- Normalización sin mayúsculas, espacios adicionales ni acentos.
- Contador `N de M operaciones`.
- Botón para limpiar.
- Mensaje cuando no existan coincidencias.
- El filtro solo afecta la vista: no modifica estado, selecciones ni datos.
- La consulta permanece durante los rerenderizados de la matriz.

## Catálogo maestro de NetSuite

El catálogo dejará de depender exclusivamente de las operaciones de las OT abiertas. La sincronización consultará mediante SuiteQL los pasos de las rutas de manufactura activas, unidos a rutas y centros de trabajo activos.

Cada entrada tendrá:

```js
{
  key: "5470::SOLDADURA DE PIEZAS",
  ct: "5470",
  label: "SOLDADURA DE PIEZAS",
  source: "NETSUITE_MASTER",
  active: true
}
```

Reglas:

- Deduplicar por CT y nombre normalizado.
- Conservar únicamente registros, rutas y centros activos.
- El selector mostrará operaciones activas que no estén ya en la matriz.
- No depender de que una operación exista en una OT.
- Si la consulta falla, conservar el último catálogo válido y devolver una advertencia; nunca reemplazarlo por una lista vacía.
- No modificar los RESTlets actuales ni el Apps Script protegido.

La fuente oficial de NetSuite establece que las rutas de manufactura son plantillas con pasos asociados a centros de trabajo; la consulta maestra se basará en esos registros, no en tareas generadas para OT.

## Exclusión de subcontratos especiales

El selector **Agregar operación** no mostrará operaciones que la lógica existente clasifique como subcontrato especial.

Incluye nombres o variantes normalizadas de:

- `SUBCONTRATO`
- `CROMADO`
- `METOKOTE`
- `MAKA`
- `GALVANIZADO`

La clasificación debe reutilizar una función compartida para que matriz y plan no diverjan.

## Exclusión global del plan

Cada fila tendrá un selector con estados:

- `Usar en el plan`
- `Excluir del plan`

El estado se guardará en `excludedCapabilities`, usando la clave de capacidad `CT::NOMBRE_NORMALIZADO`.

Una operación excluida:

- permanece visible en la matriz, atenuada y con etiqueta `Excluida`;
- aplica a todas las OT actuales y futuras;
- no se agenda ni consume operador, máquina, tiempo o capacidad;
- no genera alertas por operador, máquina, herramienta, capacidad o reglas faltantes;
- no aparece como operación programada en Gantt ni reportes de producción;
- puede reactivarse y recupera el comportamiento normal en la siguiente generación.

Antes de validar requisitos y programar, el motor retirará las operaciones excluidas. Las dependencias se reconstruirán sobre la secuencia restante de cada OT, por lo que una sucesora dependerá de la última operación incluida.

La exclusión es distinta de:

- `No finita`, que sí programa sin reservar capacidad finita.
- Eliminar de la matriz, que retira su configuración.
- Subcontrato, que conserva su flujo especial.

## Persistencia y compatibilidad

- Estados antiguos sin `excludedCapabilities` se interpretarán como lista vacía.
- Guardado, importación, exportación y restauración incluirán la nueva colección.
- Al renombrar o eliminar una capacidad, se limpiará/migrará su exclusión junto con sus demás claves.
- Las operaciones obligatorias generadas por el sistema conservarán sus reglas actuales.

## Pruebas

- Buscar por nombre, CT, texto parcial, acentos y mayúsculas.
- Limpiar búsqueda, contador y cero resultados.
- Catálogo maestro independiente de las OT.
- Exclusión de inactivas, duplicadas, agregadas y subcontratos especiales.
- Fallback al último catálogo válido ante error.
- Operación excluida no se valida, agenda ni consume capacidad.
- Reactivación restaura la programación.
- Exclusión intermedia reconstruye precedencias correctamente.
- Persistencia e importación de `excludedCapabilities`.

## Fuera de alcance

- Exclusión por OT individual.
- Modificar rutas o centros de trabajo en NetSuite.
- Modificar los RESTlets o el Apps Script protegido.
