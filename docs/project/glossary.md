# Glosario

Términos del dominio de **plangit** (Plan Maestro de Producción). Cualquier término que se vuelva
relevante por primera vez debe añadirse aquí.

| Término | Definición |
|---|---|
| **OT / Orden de trabajo** | Folio de orden de trabajo en NetSuite (`tranid`); clave de agrupación de operaciones y materiales. Columna `OT`. |
| **WO_INTERNAL_ID** | ID interno de NetSuite de la OT (`internal id`); usado para unir `MATERIALES` y en consultas directas. |
| **CT / Centro de trabajo** | Capacidad/área de manufactura (p. ej. Corte, Doblez). Clave de capacidad `CAPACIDADES.KEY` con formato `CT::OPERACION` en general. |
| **Capacidad** | Fila de `CAPACIDADES`: key, CT, operación, activa, horas/día, solapamiento, palabras clave, requerimientos de herramental/kit, eficiencia. |
| **Matriz (MATRIZ)** | Hoja que habilita capacidades por operador (`CAPACIDAD_KEY`, `OPERADOR`, `HABILITADO`). |
| **Operador** | Recurso humano con capacidad diaria (`MINUTOS_CAPACIDAD`), rendimiento (`RENDIMIENTO_PCT`), nombre y categoría (`ACABADOS`, `FUERA_DE_PLAN`, `TD`). |
| **Máquina** | Recurso de máquina (`MAQUINAS`), referencia desde `OPERACIONES.MAQUINA` y `CALENDARIO.MAQUINA`. |
| **Herramental / Kit** | Herramienta y kit por parte (`HERRAMENTALES`); con tiempos de ajuste (`TIEMPO_AJUSTE_HERR`, `TIEMPO_AJUSTE_KIT`). |
| **BOM / Materiales** | Lista de materiales por OT (hoja `MATERIALES`): componente, unidad, requerido/emitido/pendiente. |
| **Borrador (BORRADOR_PLAN)** | Plan de trabajo en edición; hoja con el esquema de snapshot (30 columnas). |
| **Publicar** | Acción que convierte el borrador en instantánea (`PLANES_HISTORICOS`) con `SNAPSHOT_ID`. |
| **Snapshot / Instantánea** | Conjunto de filas de un plan publicado en `PLANES_HISTORICOS`. |
| **TIPO_INSERCION** | Tipo de inserción de una operación: `OPERATION`, `SUBCONTRATO`, `CAMBIO_HERRAMENTAL`. |
| **TIPO_SUBCONTRATO** | Tipo de subcontrato (cromado, metokote, maka) referenciado en `SUBCONTRATOS` por `PARTE`. |
| **ESTATUS_PLAN** | Estado de una operación en el plan: `PENDIENTE` (default) o `COMPLETADA_PLAN`. |
| **selectedOts** | Lista de OTs seleccionadas del borrador; fuente única para Gantt, KPI, backlog, cargas y reportes. |
| **lockedOts** | OTs bloqueadas que no se reprograman. |
| **operationPlanStatuses** | Estados por operación (`ESTADOS_OPERACION_PLAN`). |
| **Doblado** | Operaciones de los CT 5459/5527; la preparación de la OT precarga máquina/herramental/kit desde el catálogo del artículo. |
| **Subcontrato** | Proceso externo (cromado/metokote/maka) con `DIAS_HABILES`; una OT puede tener operaciones de subcontrato. |
| **Planta MM del Llano** | Ubicación NetSuite de la planta (`locationId = 1`, `PP_PLANT_NAME`); filtro fijo de sincronización. |
| **RESTlet** | Script NetSuite expuesto como servicio HTTP (1764/1762/1763/2080); el backend los invoca con OAuth 1.0a. |
| **SuiteQL** | Consulta SQL sobre NetSuite vía REST (catálogo maestro, promedios de facturación, rutas directas de OT). |
| **OAuth 1.0a** | Esquema de autenticación HMAC-SHA256 para NetSuite (`PP_oauthHeader_`). |
| **Bridge** | Página-iframe de Apps Script (`Bridge.html`) que traduce `window.postMessage` → `google.script.run`. |
| **FRONTEND_ORIGIN** | Origen permitido del frontend (`https://rikrdo0701-cmyk.github.io`) validado por el puente. |
| **ALLOWED_METHODS** | Lista cerrada de métodos backend invocables a través del puente. |
| **PWA / Service Worker** | Soporte offline y caché del frontend publicado en GitHub Pages. |
| **Ruta / Tramo** | Secuencia de manufactura de un artículo y sus dibujos (inspección, hoja `Tramos`). |
| **Semáforo de inspección** | Estado visual por OT al imprimir (verde/amarillo/rojo según alertas, pendientes, faltas). |
| **Plan Maestro (legacy)** | Hoja de salida del pipeline legacy (`WRITTER.js`), independiente de `src/server`. |
