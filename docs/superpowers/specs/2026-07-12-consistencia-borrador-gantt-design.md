# Diseño: consistencia del borrador, Gantt y recursos

## Objetivo

Garantizar que toda acción del plan use exclusivamente el borrador actual, que la interfaz represente el estado real del motor y que las operaciones de doblado y cambios de herramental nunca desaparezcan silenciosamente.

## Vista activa del Gantt

Las vistas `OT`, `CT`, `Máquina` y `Operador` tendrán una única fuente de verdad: `state.ganttView`.

Al cambiar de vista:

- se actualizará inmediatamente `state.ganttView`;
- se invalidará la caché de agrupación;
- se renderizará el Gantt con la agrupación seleccionada;
- el botón correspondiente conservará estado visual activo y accesible;
- el valor persistirá después de guardar, sincronizar, reprogramar o recargar.

Ningún render parcial podrá restablecer visualmente la vista predeterminada sin modificar también el estado.

## Alcance de OTs planeadas

`state.selectedOts` será la lista autoritativa para preparación, validación, programación y exportación del borrador.

Al devolver una tarjeta al backlog:

- la OT se eliminará inmediatamente de `selectedOts`, `lockedOts`, prioridades y `lastSchedule.scheduledOts`;
- no se borrará su configuración reutilizable de artículo u OT;
- ninguna validación o diálogo posterior podrá incluirla.

Antes de preparar una OT o abrir un diálogo durante la generación, la aplicación volverá a comprobar que siga seleccionada. Los ciclos asincrónicos operarán sobre una copia actual de la selección, no sobre una lista obsoleta capturada antes de mover tarjetas.

## Preparación idempotente

Una OT ya preparada no volverá a solicitar los mismos datos al generar el plan. El diálogo reaparecerá únicamente cuando:

- falte un dato obligatorio;
- las operaciones sincronizadas hayan cambiado y agreguen un requisito;
- el usuario vuelva a agregar la OT desde el backlog, caso en que confirmará los valores precargados conforme al diseño anterior.

El precio vacío o cero no es un requisito obligatorio.

## Completar desde Detalle de OT

El detalle del borrador permitirá `Completar` y `Reabrir` cada operación.

Una operación completada:

- permanecerá visible en el detalle con estado `Completada`;
- conservará fechas y recursos históricos;
- ofrecerá `Reabrir`;
- desaparecerá del Gantt, cargas y reportes pendientes;
- no se reprogramará ni consumirá capacidad.

Las versiones publicadas seguirán siendo de solo lectura.

## Doblado y cambios de herramental

El motor deberá programar dos OTs que utilicen la misma máquina aunque requieran herramientas o kits distintos.

Para cada transición:

- se conservará la operación productiva de doblado;
- se generará una operación de cambio asignada al ajustador configurado;
- el cambio tendrá inicio, fin, duración y transición origen/destino;
- la máquina y el ajustador respetarán capacidad y secuencia;
- la operación productiva comenzará después del cambio requerido.

Una operación que no pueda programarse no desaparecerá: quedará como `UNSCHEDULED` con diagnóstico de OT, secuencia y causa concreta, por ejemplo máquina, herramienta, ajustador, capacidad u horizonte técnico.

## Fuentes de reportes

El selector `Plan` mostrará únicamente:

- `Borrador`;
- versiones con estado `PUBLICADO`.

Snapshots guardados que no estén publicados no aparecerán en el selector operativo. El borrador será editable; los publicados serán de solo lectura.

## Exportación

`Exportar` generará una instantánea CSV del borrador actual, independientemente de la fuente seleccionada en reportes.

Incluirá exclusivamente operaciones que cumplan todas estas condiciones:

- OT presente en `selectedOts`;
- estado pendiente, no `COMPLETADA_PLAN`;
- inicio y fin programados;
- pertenecen al borrador actual.

Excluirá backlog, completadas, operaciones sin hueco, snapshots históricos y planes publicados.

## Pruebas y aceptación

La implementación incluirá:

- prueba de correspondencia entre `state.ganttView`, agrupación y botón activo en los cuatro modos;
- prueba de persistencia de vista después de render y recarga;
- prueba de quitar una OT y confirmar que no se prepara ni programa;
- prueba contra selección asincrónica obsoleta;
- prueba de preparación idempotente;
- prueba de completar y reabrir desde detalle del borrador;
- prueba de exclusión de completadas en Gantt, cargas y pendientes;
- prueba con dos OTs, misma máquina y herramientas distintas, incluyendo cambio de herramental;
- prueba de diagnóstico para doblado no programado;
- prueba de selector limitado a Borrador/Publicados;
- prueba de CSV limitado al borrador pendiente programado;
- QA de navegador de todos los controles y ausencia de errores relevantes en consola.
