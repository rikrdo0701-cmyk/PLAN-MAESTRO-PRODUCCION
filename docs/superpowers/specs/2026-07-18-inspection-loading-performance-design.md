# Optimización de carga de hoja de inspección

## Objetivo

Reducir el tiempo percibido al abrir órdenes de trabajo (WO), especialmente las más recientes, sin mostrar datos obsoletos ni aumentar llamadas duplicadas.

## Problema actual

La interfaz consulta secuencialmente:

1. detalle de la WO;
2. rutas de dibujo, aunque el detalle ya las integra;
3. historial.

Cada cambio de WO acumula viajes entre navegador, Apps Script y NetSuite. Una WO nueva no se beneficia de la caché de selecciones anteriores.

## Diseño aprobado

### Respuesta consolidada

Crear `getInspectionWorkOrderBundle(wo, options)` en el servidor. Devolverá en una sola llamada:

```js
{
  ok: true,
  data: {
    detail: {},
    history: []
  }
}
```

`detail` conservará las rutas de dibujo que ya agrega `getInspectionWorkOrder`. La interfaz dejará de llamar separadamente a `getInspectionDrawingRoutes` y `getInspectionHistory`.

`options.forceRefresh === true` omitirá las cachés para el botón **Recargar**.

### Caché

- Caché del navegador por WO: 5 minutos.
- Caché de Apps Script por WO: 5 minutos.
- No guardar respuestas fallidas.
- **Recargar** siempre fuerza una consulta nueva y reemplaza la entrada almacenada.

### Precarga

Después de obtener la lista, precargar silenciosamente las primeras 5 WO, que corresponden a las más recientes.

- Máximo 2 solicitudes simultáneas.
- La selección manual tiene prioridad sobre nuevas tareas de precarga.
- Una promesa compartida por WO evita solicitudes duplicadas si el usuario selecciona una orden que se está precargando.
- Un fallo de precarga no muestra error; la selección posterior vuelve a intentarlo.

### Consistencia de interfaz

Cada selección recibe un identificador de solicitud. Una respuesta solo puede actualizar la pantalla si todavía corresponde a la WO seleccionada. Así, una respuesta lenta anterior no reemplazará una selección más reciente.

Durante la carga se conserva el estado visual existente. Al completarse, se renderizan detalle e historial desde el mismo paquete.

## Archivos previstos

- `src/server/17-inspection-drawing-service.js`: servicio consolidado y caché de Apps Script.
- `src/web/inspection/inspection-app.js`: caché del navegador, solicitudes compartidas, cola de precarga y protección contra respuestas obsoletas.
- `tests/inspection-service.test.mjs`: contrato del paquete, caché y recarga forzada.
- `tests/build.test.mjs`: comportamiento del cliente y ausencia de llamadas redundantes.

## Pruebas de aceptación

- Abrir una WO precargada no crea una segunda llamada.
- Solo se precargan las 5 WO más recientes.
- La precarga nunca supera 2 solicitudes simultáneas.
- **Recargar** omite ambas cachés.
- Las rutas y el historial aparecen con una sola llamada del cliente.
- Una respuesta atrasada no sustituye la WO seleccionada actualmente.
- Una precarga fallida se reintenta al seleccionar la WO.
- Las pruebas existentes siguen pasando.

## Fuera de alcance

- Cambiar endpoints o credenciales de NetSuite.
- Modificar el formato de datos de inspección.
- Precargar más de 5 WO o persistir caché entre sesiones del navegador.
- Tocar el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
