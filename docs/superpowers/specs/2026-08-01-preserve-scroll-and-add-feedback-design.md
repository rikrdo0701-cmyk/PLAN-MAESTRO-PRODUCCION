# Modo rendimiento para agregar y editar OTs

## Objetivo

Hacer que agregar, abrir y completar operaciones se sienta inmediato, sin movimientos inesperados de la vista ni fallos silenciosos.

## Diseño

### Consulta y caché

- Tras sincronizar OTs, precargar las cinco activas más nuevas con máximo dos solicitudes simultáneas.
- Una búsqueda de folio exacto eleva esa OT a prioridad inmediata.
- Ruta, CT, tiempos y materiales permanecen diez minutos en caché y pueden compartirse entre detalle y agregado.
- `+` reutiliza la caché o solicitud existente; una consulta no precargada tiene límite de treinta segundos.
- La tarjeta muestra texto compacto `Cargando`, `Guardando`, `Guardado` o `Error`; no depende solo de sombras.
- Toda salida inesperada de `selectJob`, incluida preparación, muestra el motivo y libera la tarjeta. Cancelar un diálogo no es error.

### Edición

- Completar o reabrir actualiza inmediatamente solo la fila afectada.
- El guardado atómico existente se ejecuta en segundo plano; al fallar restaura la fila y muestra el error.
- Resumen, alertas y cargas se recalculan cuando el navegador queda libre, sin render completo durante el clic.
- Hay un solo editor, por lo que no se añade sincronización multiusuario adicional.

### Desplazamiento y visuales

- `showWorkspaceView` permite reaplicar una vista sin desplazar la ventana.
- Navegación manual inicia arriba; cargas, sincronizaciones, renders y guardados preservan `scrollY`.
- Se eliminan animaciones de carga y desplazamiento suave en estos flujos.
- Las fotografías se cargan solo cuando son visibles.

## Pruebas

- Precarga limitada a cinco OTs y concurrencia dos; búsqueda exacta obtiene prioridad.
- Caché/promesa compartida evita llamadas duplicadas y expira a los diez minutos.
- Timeout de treinta segundos libera la tarjeta y permite reintentar.
- Completar/reabrir usa render de fila, guardado atómico, confirmación y reversión ante error.
- Carga remota tardía preserva `scrollY`; navegación manual inicia arriba.
- Cliente optimizado y artefacto generado mantienen estas reglas.

## Restricciones

No modificar NetSuite ni el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
