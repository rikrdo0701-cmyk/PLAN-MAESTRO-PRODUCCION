# Diseño: integración modular de Hoja de inspección

## Objetivo

Integrar en Plan Maestro de Producción la vista existente de inspección bajo el nombre visible **Hoja de inspección**, conservando su diseño, formato de impresión y comportamiento funcional, pero aislándola del motor de planeación mediante módulos propios.

La aplicación original ubicada en `nesesidades prod` será únicamente la fuente de migración. No se modificará, no se desplegará desde este repositorio y no se copiarán sus credenciales.

## Alcance

La primera versión integrada incluirá:

- navegación desde el menú lateral;
- listado de todas las OTs abiertas de NetSuite;
- búsqueda por OT, artículo y descripción;
- carga del detalle completo de una OT;
- todos los materiales y todas las operaciones devueltas por NetSuite para la OT;
- tramos por artículo y materia prima;
- dibujo asociado al artículo;
- configuración de rutas de dibujo;
- semáforo previo a impresión;
- edición de liga de tramo o dibujo;
- historial de impresiones;
- selección temporal de operaciones que deben imprimirse;
- formato de impresión existente sin líneas vacías intermedias.

No se migrarán las demás vistas de la aplicación Necesidades de producción.

## Arquitectura

La funcionalidad se dividirá en cuatro módulos con responsabilidades separadas:

### Vista

`inspection-view` contendrá exclusivamente la estructura HTML de Hoja de inspección: panel de selección, búsqueda, estado, semáforo, acciones y documento imprimible.

### Estilos

`inspection-styles` conservará el diseño visual y las reglas de impresión de la aplicación original. Sus selectores estarán contenidos dentro del módulo para evitar afectar Gantt, reportes y otras pantallas.

### Cliente

`inspection-client` administrará:

- carga y búsqueda de OTs;
- selección de OT;
- renderizado de materiales, operaciones y hoja;
- semáforo y estado de impresión;
- apertura de dibujos;
- edición de tramos y ligas;
- selección temporal de operaciones;
- preparación y limpieza del modo impresión.

El módulo no dependerá de `app.js` para su funcionamiento y no modificará estado de planeación.

### Servidor

`inspection-server` contendrá exclusivamente las funciones Apps Script necesarias para:

- consultar el listado de OTs en NetSuite;
- consultar el detalle completo de una OT;
- leer y guardar tramos y dibujos;
- leer configuración de rutas;
- registrar y consultar el historial de impresión.

La autenticación reutilizará las propiedades seguras existentes del proyecto. No se incluirán secretos en archivos versionados.

## Navegación y flujo de datos

El menú lateral incorporará la opción **Hoja de inspección**.

Al abrirla:

1. Se consultan todas las OTs abiertas de NetSuite.
2. El usuario puede buscar por OT, artículo o descripción.
3. Al seleccionar una OT se consulta su detalle completo.
4. Se muestran todos los materiales y todas las operaciones devueltas por NetSuite, aunque la OT u operación no forme parte del borrador de planeación.
5. Se combinan los datos con los tramos, dibujos e historial guardados en la hoja de inspección actual.
6. Se renderiza el documento y se habilitan sus acciones.

Plan Maestro podrá proporcionar autenticación y despliegue compartidos, pero sus colecciones locales no serán la fuente principal del detalle de inspección.

## Selección de operaciones

Cada vez que se carga una OT, todas sus operaciones comienzan seleccionadas.

El botón **Seleccionar operaciones** activa controles temporales junto a cada operación. El usuario puede desmarcar las que no desea incluir en la siguiente impresión.

La selección:

- no se guarda en servidor;
- se reinicia al cargar otra OT;
- se reinicia al volver a cargar la misma OT;
- se reinicia al cerrar o recargar la página;
- no modifica operaciones ni estados en NetSuite o Plan Maestro.

Durante la impresión:

- no aparecen el botón ni las casillas;
- se excluyen las operaciones desmarcadas;
- las operaciones restantes conservan su secuencia;
- las operaciones visibles se recorren hacia arriba;
- no quedan filas vacías entre operaciones;
- las filas vacías requeridas por el formato aparecen únicamente al final de la sección.

El historial de impresión registra las operaciones efectivamente incluidas, pero no reutiliza esa selección en impresiones posteriores.

## Impresión

Se conservarán el formato, logo, código documental, materiales, tramos, dibujo, secciones de producción y dimensiones de impresión existentes.

La preparación de impresión se realizará sobre una representación filtrada de las operaciones y se restaurará la vista interactiva al terminar. Imprimir no modificará el plan, la OT ni los estados de operación.

## Errores y seguridad

- Un fallo de NetSuite se mostrará dentro de Hoja de inspección y no bloqueará Planeación.
- Si falta tramo o dibujo, se conservará el diagnóstico del semáforo actual.
- Un fallo al guardar tramo, dibujo o historial se mostrará explícitamente y no se presentará como éxito.
- Las credenciales permanecerán en propiedades seguras de Apps Script.
- Los archivos `credenciales.txt`, `netsuiteauth.txt`, respuestas de diagnóstico y otros artefactos sensibles de la copia no se migrarán ni se versionarán.
- El módulo original no será modificado.

## Compatibilidad con GitHub Pages

En GitHub Pages la vista se podrá cargar con datos simulados para revisión visual. Las operaciones reales de lectura y escritura estarán disponibles únicamente dentro del despliegue de Apps Script.

## Comprobaciones

La implementación deberá verificar:

- carga de todas las OTs abiertas;
- búsqueda por OT, artículo y descripción;
- consulta de todas las operaciones de una OT;
- carga de materiales, tramos y dibujos;
- edición y persistencia de ligas;
- conservación del semáforo existente;
- selección temporal y reinicio correcto;
- impresión sin controles ni huecos intermedios;
- historial con las operaciones realmente impresas;
- manejo visible de errores del servidor;
- ausencia de credenciales en archivos versionados;
- ausencia de regresiones en Gantt, sincronización, reportes y generación del plan;
- QA visual en GitHub Pages y validación funcional en Apps Script.

## Fuera de alcance

- migrar las demás pantallas de Necesidades de producción;
- cambiar el diseño documental de la hoja;
- guardar permanentemente la selección de operaciones;
- actualizar estados de operación desde Hoja de inspección;
- utilizar las operaciones programadas del borrador como sustituto del detalle de NetSuite;
- modificar la aplicación original.
