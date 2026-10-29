# Fallback de un segundo para operaciones sin tiempo

## Objetivo

Permitir agregar al plan una OT cuya ruta de manufactura contenga operaciones sin tiempo configurado.

## Comportamiento

- Al consultar una OT, cada operación con tiempo vacío, cero, negativo o no numérico recibe un tiempo efectivo de 1 segundo.
- La operación conserva su secuencia, nombre y centro de trabajo, y aparece en el detalle de la OT.
- La OT puede agregarse desde el botón `+` o mediante arrastrar y soltar.
- El segundo de fallback se usa en la programación y capacidad; su impacto es mínimo y no se inventan minutos adicionales.
- Una operación sin centro de trabajo continúa invalidando la ruta, porque no puede asignarse a un recurso.
- Las operaciones con tiempo válido no se modifican.

## Flujo de datos

El servicio individual de OT normaliza el tiempo antes de validar la ruta. El cliente acepta y combina esas operaciones normalizadas en el estado del plan. De este modo, detalle, selección y programación utilizan el mismo valor y no aplican reglas contradictorias.

## Errores

La ruta solo se rechaza cuando está vacía o contiene operaciones sin centro de trabajo. El mensaje identificará la secuencia afectada. La ausencia de tiempo deja de ser un error bloqueante.

## Pruebas

- El servicio convierte una operación sin tiempo a 1 segundo.
- Una ruta con CT y tiempo faltante se acepta.
- Una ruta sin CT se rechaza.
- El cliente permite seleccionar y combinar una OT con el fallback.
- Las operaciones con tiempo válido conservan su duración.
- La suite completa continúa pasando.

## Fuera de alcance

No se modifican rutas en NetSuite, tiempos persistidos ni el proyecto de Apps Script protegido.
