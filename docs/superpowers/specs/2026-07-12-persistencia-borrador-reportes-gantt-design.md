# Diseño: persistencia coherente del borrador y planes diarios

## Objetivo

Evitar estados mezclados después de recargar, asegurar que los reportes diarios abran la fuente correcta y hacer verificable la selección del Gantt y la programación de doblado con cambio de herramental.

## Borrador persistente

El borrador se guardará y restaurará como una instantánea coherente que incluye:

- operaciones y sus fechas/recursos;
- órdenes de trabajo necesarias para mostrar backlog y planeado;
- `selectedOts`, prioridades, bloqueos y expansiones;
- configuraciones por OT y artículo;
- preparación comercial, subcontrato, máquina, herramental y kit;
- operaciones completadas y reabiertas;
- vista y escala del Gantt;
- metadatos de la última programación.

Al recargar, la aplicación restaurará primero el borrador persistido. La carga inicial de datos compartidos o NetSuite no podrá combinar `selectedOts` locales con operaciones de otra instantánea. Una sincronización explícita actualizará catálogos y datos NetSuite, pero conservará la configuración y programación del borrador hasta que el usuario vuelva a generar el plan.

Si el borrador remoto y el local existen, se elegirá el de mayor revisión/fecha guardada. La selección se hará sobre la instantánea completa; no se mezclarán colecciones de dos revisiones.

## Planes diarios

Los reportes de Operador, Ajustador y Subcontratos usarán automáticamente:

1. el último plan con estado `PUBLICADO`;
2. el borrador actual, únicamente cuando no exista ningún publicado.

El selector mostrará solo `Borrador` y planes `PUBLICADO`. La elección manual seguirá disponible y no cambiará el borrador.

## Vistas del Gantt

Los controles `OT`, `Operador`, `Máquina` y `CT` tendrán una sola fuente de verdad: `state.ganttView`.

Cada cambio:

- actualizará inmediatamente el estado;
- marcará exactamente un botón mediante clase y `aria-selected="true"`;
- reconstruirá la agrupación correspondiente;
- persistirá después de guardar, sincronizar, renderizar y recargar.

La inicialización funcionará tanto si el script carga antes como después de `DOMContentLoaded`. La prueba de navegador debe confirmar los cuatro clics en la versión generada, no solamente probar un helper aislado.

## Doblado y cambio de herramental

La aceptación requiere dos niveles:

- escenario determinista con dos OTs, misma máquina y herramientas/kits diferentes;
- escenario construido con los campos reales disponibles de las OTs afectadas.

En ambos casos deben conservarse las dos operaciones productivas de doblado. Antes de la segunda herramienta se generará `CAMBIO_HERRAMENTAL` con máquina, ajustador, inicio, fin, duración y transición origen/destino. La operación productiva comenzará después del cambio.

Si falta máquina, herramental, kit, ajustador, capacidad o hueco técnico, la operación permanecerá como `UNSCHEDULED` y mostrará OT, secuencia y causa. Nunca desaparecerá silenciosamente del resultado ni del diagnóstico visible.

## Recuperación de inconsistencias existentes

Si al cargar se detectan KPI, `selectedOts`, órdenes y operaciones incompatibles:

- se conservará la última instantánea completa válida;
- se descartará la mezcla parcial;
- se mostrará una alerta de recuperación;
- no se publicará ni sobrescribirá el borrador hasta completar la restauración.

## Pruebas de aceptación

- Restaurar página conserva OTs planeadas, backlog, prioridades, operaciones, ajustes y programación.
- La carga compartida no reemplaza operaciones del borrador con una instantánea distinta.
- Sin plan publicado, los tres reportes diarios usan Borrador.
- Con planes publicados, los tres usan el último publicado.
- El selector excluye guardados no publicados.
- Cada vista Gantt queda agrupada y marcada correctamente antes y después de recargar.
- Dos doblados con herramientas distintas generan ambas operaciones y el cambio completo.
- Un doblado no programable permanece visible con diagnóstico detallado.
- Build, suite completa, consola y QA de GitHub Pages no presentan errores relevantes.
