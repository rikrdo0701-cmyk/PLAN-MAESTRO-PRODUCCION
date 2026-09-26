# Sondas de diagnóstico (Apps Script)

Archivos `.gs` que se **pegan en el editor de Apps Script** del proyecto y se ejecutan desde ahí.
No forman parte del bundle: el build no los lee, y por eso viven aparte y no se versionan con
el código de la app. Todos son de **solo lectura** contra NetSuite o el backend: ninguno escribe
en la hoja ni en la configuración.

| Archivo | Función que se ejecuta | Para qué sirve |
|---|---|---|
| `DIAG_precios1766.gs` | `DIAG_precios1766` | Descubre de dónde sale el precio de venta y cuánto cuesta traerlo. Hace una **llamada de guardia** (si la cuota diaria de `urlfetch` está agotada, para ahí) y luego 8 llamadas de lectura al RESTlet 1766 (`REQ_FIFO`): (1) prueba `pageSize` 200, 500, 1000 y 2000 para ver el máximo real y cuántos `rows` devuelve cada uno; (2) vuelca `headers` y las primeras filas literales, donde puede aparecer el id o tipo de registro que revela la fuente física; (3) prueba si el 1766 acepta una ventana de fechas en el body (`from/to`, `fechaDesde/fechaHasta`, `dateFrom/dateTo`, `startDate/endDate`). Con eso se decide si el precio puede entrar al RESTlet 2244 con una consulta agregada, o si hay que cachearlo. |
| `DIAG_operaciones2240.gs` | `DIAG_operaciones2240` | Cuenta las operaciones abiertas **por planta** que trae el RESTlet 2240, para decidir si conviene bajar el filtro de ubicación al SQL. Hace una **llamada de guardia** (si la cuota diaria de `urlfetch` está agotada, para ahí) y luego: (1) lee `totalRows` y lo compara con el techo que la app pone hoy (20 páginas × 200 = 4000) para saber si la lista se está truncando en silencio; (2) recorre las páginas que la app permitiría y agrupa por cualquier columna de ubicación o planta que exista en la respuesta; (3) cruza contra `WO_LISTA` con el mismo `PP_buildPlantFilter_`/`PP_belongsToPlant_` que usa el servidor, y dice cuántas filas son de planta 1 y cuántas se descartarían. Sostiene `PP_DIAG_QUOTA_EXHAUSTED_` en lugar de repetir la función del 1766. |
| `DIAG_operaciones2240b.gs` | `DIAG_operaciones2240b` | Diagnostica el SQL del 2240 desde Apps Script por la API REST de SuiteQL (el camino del catálogo maestro). **Ya no autoriza la subida**: la corrida del 2026-09-26 07:31 demostró que ese endpoint y el `query.runSuiteQL` de dentro de NetSuite no aceptan lo mismo, así que su veredicto es engañoso; el 2240 lleva un *fallback de estrategias* que lo hace seguro de subir. Ahora sirve para: aislar **qué columna** rechaza el endpoint (una `BUILTIN.DF` por consulta), mostrar el error **completo** (antes se cortaba a 300 caracteres y se perdía el nombre del campo), probar el SQL completo de producción, ver si `tl.location = 1` devuelve filas, y el desglose de operaciones por ubicación. |
| `DIAG_inspeccion400.gs` | `DIAG_inspeccion400` | Primera ronda del diagnóstico del `NetSuite inspeccion: 400`. Confirma script/deploy reales, `locationId`, y si el RESTlet responde con `ok:false` en 200 (validación de payload) en vez de un HTTP 400. |
| `DIAG_inspeccion400b.gs` | `DIAG_inspeccion400b` | Segunda ronda: barre 40 folios reales con `action:detail`, dispara 8 `detail` concurrentes y prueba folios malformados (apóstrofo, `OR 1=1`, `%`, 90 caracteres, vacío). Sirvió para descartar folio sucio, concurrencia e interpolación en el SuiteQL del RESTlet. |

## Cómo se usan

1. Abre el proyecto en <https://script.google.com> y ve al editor.
2. Crea un archivo `.gs`, pega el contenido **sin** el comentario de cabecera (el comentario
   está pensado para leerlo aquí, pero no estorba si lo dejas).
3. Guarda y ejecuta la función homónima desde el selector de la barra de arriba.
4. Pega el **registro de ejecución** completo.

`DIAG_precios1766` usa `PP_netSuiteConfig_` y `PP_netSuiteRestletRequest_`, que ya existen en el
proyecto; si se pega en otro script, hay que quitar esa dependencia o usar las credenciales
directamente. El `pageSize` por defecto es `1766/deploy 1`, que es el documentado; si el
RESTlet se movió, se overridea con las Script Properties `NS_SALES_PRICES_SCRIPT` y
`NS_SALES_PRICES_DEPLOY`.

Dos avisos prácticos al ejecutarla:

- **Puede tardar uno o dos minutos.** `PP_netSuiteRestletRequest_` reintenta con esperas de
  2/5/10 s cuando NetSuite responde `400 SSS_REQUEST_LIMIT_EXCEEDED`, y la sonda hace 9
  llamadas. El límite de 6 min de Apps Script aguanta de sobra, pero no es instantáneo.
- **La cuota diaria de `urlfetch` puede estar agotada.** Apps Script la impone por consumidor
  (20 000/día en cuentas de consumidor) y, cuando se agota, *toda* llamada falla con
  `Service invoked too many times for one day: urlfetch` **sin llegar a NetSuite**. Por eso la
  sonda hace una llamada de guardia y, si detecta eso, se detiene y dice cuándo reintentar en
  lugar de gastar 8 llamadas más en guaranteed failures. El límite se reinicia a medianoche
  hora del Pacífico.
- **`log()` es un helper local** de la sonda, no una función de Apps Script. La primera versión
  la usaba sin definirla y falló con `ReferenceError: log is not defined`; ahora el archivo
  declara `function log(message) { Logger.log(String(message)); }` al inicio. Si pegas las
  llamadas en otro archivo, esa declaración tiene que ir con ellas.