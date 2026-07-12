# Diseño: reprogramación, estados y reportes operativos

## Objetivo

Conseguir que la reprogramación del borrador sea rápida y determinista, que las operaciones completadas no consuman capacidad futura y que los planes de operador, ajustador y subcontrato cubran todas las operaciones programadas sin duplicarlas.

## Alcance

El cambio cubre:

- sincronización previa con NetSuite;
- reprogramación exclusiva del borrador;
- estados `PENDIENTE` y `COMPLETADA_PLAN`;
- acciones y filtros en planes de operador y ajustador;
- impresión filtrada;
- estado visual del botón de PDF;
- validación de cobertura entre reportes.

Los planes guardados, publicados e históricos no se recalculan ni se sobrescriben al generar un nuevo borrador.

## Sincronización de NetSuite

Antes de programar, la aplicación reutilizará datos sincronizados recientemente. Una actualización automática tendrá un límite de 15 segundos.

Si NetSuite excede el límite o devuelve error:

- con operaciones y materiales ya cargados, la programación continuará y mostrará una advertencia de datos existentes;
- sin datos disponibles para las OTs seleccionadas, la programación se detendrá con un mensaje claro;
- el indicador de carga finalizará siempre y el botón volverá a habilitarse.

El botón `Sincronizar` seguirá forzando una actualización, incluso cuando exista una copia reciente. Las solicitudes concurrentes se compartirán o rechazarán de forma controlada; nunca dejarán la interfaz bloqueada indefinidamente.

## Reprogramación del borrador

Al generar el plan se reemplazarán fechas, recursos y resultados calculados anteriores únicamente para operaciones movibles del borrador seleccionado. Esto elimina resultados obsoletos como un subcontrato de 30 minutos antes de ejecutar nuevamente el motor.

No se limpiarán:

- operaciones completadas;
- operaciones bloqueadas;
- versiones guardadas o publicadas;
- instantáneas históricas.

Un subcontrato usará el tipo y los días configurados para la OT. Su final podrá rebasar el horizonte visible sin perder la asignación.

## Estados operativos

Los planes de operador y ajustador ofrecerán:

- `Completar` para cambiar una operación pendiente a `COMPLETADA_PLAN`;
- `Reabrir` para devolver una operación completada a pendiente.

La interfaz aplicará el cambio inmediatamente y lo guardará en el backend en segundo plano. Si el guardado falla, mostrará una advertencia y conservará una acción de reintento o restaurará un estado coherente.

Una operación completada:

- conserva OT, descripción, recurso y fechas históricas;
- no vuelve a programarse;
- no consume capacidad futura de operador, ajustador o máquina;
- no cuenta como carga pendiente ni tiempo pendiente en los indicadores actuales;
- permanece disponible en filtros históricos.

## Filtros e impresión

Los planes de operador y ajustador tendrán tres filtros:

- `Pendientes`;
- `Completadas`;
- `Todas`.

La tabla y los contadores se calcularán desde el mismo conjunto filtrado. Al imprimir, únicamente aparecerán las filas que correspondan al filtro activo; las filas ocultas por el filtro no formarán parte de la salida.

## Clasificación de reportes

Cada operación programada no completada se clasificará exactamente una vez:

- operación productiva: plan del operador asignado;
- cambio de herramental: plan del ajustador;
- operación externa: plan de subcontratos.

No se mostrarán filas informativas de otros recursos dentro del plan de un operador. Los intervalos entre sus operaciones son válidos cuando la OT continúa con otro recurso.

Una validación de cobertura detectará operaciones sin reporte o duplicadas. El diagnóstico incluirá OT, secuencia, operación y categorías encontradas.

## Generación de PDF

Al pulsar `Generar PDF`:

1. el texto cambiará inmediatamente a `Generando…`;
2. el botón quedará deshabilitado para impedir dobles clics;
3. el estado permanecerá durante carga de snapshot, renderizado y apertura del documento;
4. en éxito o error recuperará texto y disponibilidad mediante un bloque de finalización garantizada.

## Persistencia y rendimiento

La aplicación usará respuesta inmediata en cliente y persistencia posterior para cambios de estado. El cálculo del plan se mostrará antes de terminar guardados no esenciales. Los fallos de persistencia no dejarán controles deshabilitados.

Las consultas de NetSuite se reducirán mediante una marca de sincronización reciente y reutilización de datos existentes. No se añadirán consultas por cada operación.

## Pruebas y aceptación

La implementación incluirá pruebas que demuestren:

- timeout de NetSuite sin bloqueo permanente;
- continuación con datos existentes y rechazo sin datos;
- limpieza exclusiva de operaciones movibles del borrador;
- preservación de completadas, bloqueadas e históricos;
- subcontrato de 15 días al reprogramar la OT 1325;
- completar y reabrir operaciones;
- exclusión de completadas en capacidad y carga pendiente;
- filtros pendientes, completadas y todas;
- impresión limitada al filtro activo;
- cobertura exactamente una vez en operador, ajustador o subcontrato;
- estado `Generando…` restaurado tanto en éxito como en error;
- ausencia de errores relevantes en consola durante el flujo validado en navegador.
