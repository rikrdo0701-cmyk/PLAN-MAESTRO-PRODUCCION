# Consulta individual de OT al agregar a Planeado

## Objetivo

Agregar una OT desde Backlog sin sincronizar todas las operaciones de NetSuite. El mismo flujo debe funcionar al pulsar `+` y al arrastrar la tarjeta hacia Planeado.

## Flujo

1. La interfaz recibe la intención de agregar una OT por clic o drag and drop.
2. Si la OT ya tiene operaciones válidas en memoria, continúa sin consulta.
3. Si no las tiene, bloquea temporalmente esa tarjeta y solicita al backend los datos individuales de la OT.
4. El backend consulta por folio los datos de la OT, materias primas y operaciones.
5. Normaliza operaciones con OT, CT, secuencia, estado y tiempos usando el mismo contrato del planeador.
6. La interfaz integra solo los registros de esa OT, invalida las cachés derivadas y agrega la OT a Planeado sin recargar la página.

## Componentes

- Un servicio Apps Script de consulta individual que devuelve `{ workOrder, materials, operations }`.
- Un método cliente compartido por clic y drag and drop.
- Una función de fusión que reemplaza únicamente datos de la OT consultada y conserva el borrador restante.

## Errores y concurrencia

- Mientras consulta, la tarjeta muestra carga y no acepta una segunda acción.
- Si faltan operaciones, CT o tiempos indispensables, la OT permanece en Backlog y se muestra un mensaje específico.
- Un error de NetSuite no elimina datos locales ni dispara una sincronización completa automática.
- Las respuestas tardías se ignoran si la OT ya fue retirada o agregada por otra acción.

## Rendimiento

- Se conserva el límite general actual; no se amplía a 10,000 filas.
- La acción individual no renderiza tarjetas adicionales ni refresca toda la vista.
- Los datos individuales exitosos quedan disponibles en memoria para acciones posteriores.

## Pruebas

- Clic `+` consulta y agrega una OT sin operaciones precargadas.
- Drag and drop usa exactamente el mismo flujo.
- Una OT ya cargada no repite la consulta.
- Respuesta válida fusiona MP y operaciones solo de la OT solicitada.
- Respuesta incompleta o fallida mantiene la OT en Backlog.
- Acciones simultáneas no duplican consultas ni agregados.
