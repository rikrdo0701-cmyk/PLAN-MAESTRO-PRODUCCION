# Selección estable de OT en el panel de detalle

## Objetivo

El panel de detalle debe mostrar siempre la última OT pulsada, aunque se carguen
operaciones, se ejecute una sincronización o existan IDs de operación repetidos
en datos anteriores.

## Diseño

- Añadir `selectedDetailOt` al estado de interfaz como fuente principal del
  folio mostrado en el panel.
- `openSelectedJobDetail(ot)` asignará primero `selectedDetailOt` y después la
  operación inicial disponible.
- `getSelectedPriorityJob()` y `selectedJobOt()` priorizarán
  `selectedDetailOt`; `selectedOperationId` seguirá identificando únicamente
  una fila operativa.
- Al cerrar el panel se limpiarán ambos valores.
- Durante cargas asíncronas, una respuesta solo podrá actualizar la operación
  seleccionada si `selectedDetailOt` todavía corresponde a la OT solicitada.
- Estados antiguos sin `selectedDetailOt` conservarán el comportamiento
  compatible, infiriendo inicialmente el folio desde `selectedOperationId`.

## Persistencia y sincronización

`selectedDetailOt` es estado de interfaz y no modifica el plan ni NetSuite.
Las sincronizaciones podrán conservar temporalmente la ruta de esa OT mientras
el panel esté abierto, usando el folio explícito.

## Pruebas

- Cambiar el detalle de OT 1325 a OT 2773 muestra 2773 inmediatamente.
- Una respuesta tardía de 1325 no revierte la selección a 1325.
- Una sincronización con el detalle de 2773 abierto no cierra el panel.
- Cerrar el panel limpia la OT y la operación seleccionadas.
- El estado anterior sin `selectedDetailOt` sigue abriendo detalles.
