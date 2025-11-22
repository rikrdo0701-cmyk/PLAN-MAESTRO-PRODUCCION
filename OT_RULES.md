# Reglas de mapeo entre hojas: Control de trabajos → Trabajos programados → Operaciones programadas

Objetivo: dejar por escrito las reglas esenciales para que el parser y el modelo lógico hagan el mapeo correcto entre las 3 hojas principales y evitar errores de unión.

Resumen del flujo (alto nivel)
1. Control de trabajos
   - Columna clave esperada: TRABAJO (valor visible, p. ej. "5" o "OT-5" o texto mostrado por HYPERLINK).
   - Este valor es la referencia humana/visible de la orden.

2. Trabajos programados
   - Columna clave visible: Folio de trabajo (link) — corresponde al mismo valor de TRABAJO.
   - Columna clave interna: ID Interno — identificador numérico usado por NetSuite.
   - Regla: para cada fila, Folio de trabajo (link) → ID Interno.
   - El parser debe producir un mapa (TRABAJO normalizado) → ID Interno.

3. Operaciones programadas
   - Columna: Orden de trabajo — contiene el ID Interno (no el TRABAJO visible).
   - Regla: la Orden de trabajo en operaciones debe coincidir exactamente con ID Interno del paso anterior.
   - Las operaciones asociadas a un mismo ID Interno se agrupan por secuencia (1, 2, ...).

Diagrama simple
Control de trabajos (TRABAJO = 5)
     ↓
Trabajos programados (Folio de trabajo = 5 → ID Interno = 12)
     ↓
Operaciones programadas (Orden de trabajo = 12 → secuencias 1,2,...)

Reglas de normalización (para evitar no coincidencias)
- Normalizar TRABAJO / Folio:
  - Eliminar prefijos como "OT-", "O.T.", "ot-" al comparar.
  - Eliminar caracteres no alfanuméricos innecesarios (p. ej. paréntesis), pero conservar números.
  - Trim de espacios y conversión de números como "05" → "5".
  - Si la celda contiene HYPERLINK(...,"texto"), usar el texto mostrado (lo que devuelve getValues normalmente).
- ID Interno:
  - Debe tratarse como cadena trim() (normalmente numérica).
  - Si la columna ID Interno está vacía, el trabajo no podrá mapearse: detectar y reportar.
- Orden de trabajo en Operaciones:
  - Debe contener exactamente el ID Interno (sin prefijos). Si viene con prefijo, aplicar normalización similar a ID.

Encabezados exactos esperados por los parsers
- Control de trabajos:
  - STATUS, TRABAJO, PARTE, REVISION, CANTIDAD, PRIORIDAD, FECHA REQUERIMIENTO, FECHA FIN ORACLE, CLIENTE, MAQUINA, MEDIDA, HERRAMENTAL, KIT HERRAMENTAL, CONTENIDO, SUBCONTRATO, ...
- Trabajos programados:
  - Folio de trabajo (link), Artículo, Cantidad, Estado, Fecha inicio de producción, Fecha finalización de producción, Ubicación, ID Interno
- Operaciones programadas:
  - ID (link), Operación, Orden de trabajo, Secuencia, Fecha inicio programada, Fecha fin programada, Estado, Centro de trabajo, Tiempo preparación (min), Tiempo estimado (min), ...

Buenas prácticas en las hojas (recomendaciones)
- Asegurar que la fila de encabezado esté en la fila 1; si hay un título en fila 1, mover encabezados a la fila 2 o usar parsers que detecten encabezado en primeras 5 filas.
- Rellenar siempre la columna "ID Interno" en Trabajos programados si la fila debe participar en replan.
- Evitar escribir el mismo TRABAJO en formatos distintos (p. ej. "5" y "OT-5") — si es necesario, confiar en la normalización pero documentar los casos atípicos.
- Registrar en una columna de diagnóstico (ej. "MAP_STATUS") cuando una fila no pudo mapearse: motivo (ID faltante / TRABAJO no encontrado / Orden de trabajo sin coincidencia).

Comprobaciones automáticas sugeridas (checks a correr antes de planificar)
1. Verificar que no existan filas en Control de trabajos cuyo TRABAJO normalizado no tenga entrada en el mapa TRABAJO→ID (Trabajos programados). Reportar lista.
2. Verificar que todas las Operaciones Programadas tienen Orden de trabajo que exista en el conjunto de ID Interno. Reportar operaciones huérfanas.
3. Validar que ID Interno es numérico (o no vacío). Reportar filas con ID inválido.
4. Loggear colisiones en el mapa (mismo TRABAJO ligado a múltiples ID Interno) y avisar.

Mensajes de error/diagnóstico recomendados
- "OT sin ID Interno en Trabajos programados: <valor TRABAJO visible>"
- "Orden de trabajo en Operaciones no encontrada en Trabajos programados: <id_operacion> (Orden: <valor>)"
- "ID Interno vacío en Trabajos programados (Folio: <valor>)"

Ejemplo práctico
- Control de trabajos (fila): TRABAJO = "5"
- Trabajos programados (fila): Folio de trabajo (link) = "5", ID Interno = "12"  → map["5"] = "12"
- Operaciones programadas (filas): Orden de trabajo = "12" → operaciones asociadas: secuencia 1, secuencia 2, ...

Integración con parsers (qué esperar del código)
- parseTrabajos() debe devolver un array con objetos que contengan al menos { TRABAJO, ID }.
- mapOTtoIDinterno(trabajos) debe usar normalizeOTKey() sobre TRABAJO y producir map[normalize(TRABAJO)] = ID.
- construirModeloLogico() debe usar normalizeOTKey(info["TRABAJO"]) para buscar el idReal en el mapa.
- parseOperaciones() debe devolver objetos donde "Orden de trabajo" sea comparado contra el ID Interno (string trimmed).

Checklist antes de ejecutar mainRunPlanner()
- [ ] Las hojas tienen encabezados detectables (fila 1 o detectables en filas 1–5).
- [ ] Trabajos programados tiene columna "ID Interno" con valores para los trabajos a planificar.
- [ ] No hay colisiones TRABAJO→ID sin resolución.
- [ ] Los CT (centros de trabajo) en Operaciones están mapeados en BALANCE DE CARGAS para asignar operadores.

Sincronización con la hoja PM_Guía (en el Spreadsheet)
- Existe una hoja llamada "PM_Guía" dentro del Spreadsheet que contiene la versión viva de estas reglas.
- El script `pm_rules_sheet.gs` (en el proyecto de Apps Script) permite: initPMGuia(), appendRule(title,content,author) y promptAppendRule() para mantener la guía actualizada desde el UI.
- Recomendación: cada cambio relevante de reglas debe registrarse tanto en OT_RULES.md como en la hoja PM_Guía (una es la versión canonical en repo; la otra es la versión práctica en el spreadsheet).

Cómo contribuir nuevas reglas (procedimiento)
1. Añadir la regla en la hoja PM_Guía usando el menú "PM Guía" o appendRule(...).
2. Probar el cambio si afecta parsers/modelo mediante runDryRun() y revisar PM_Modelo_Debug.
3. Actualizar OT_RULES.md en el repo con la nueva regla y un breve motivo.
4. Crear un commit en la rama main (o PR si trabajas con revisión).

Formato recomendado para nuevas reglas en el repo
- Título (una línea)
- Descripción (qué hace la regla)
- Afecta a (hoja(s) y parser(s))
- Fecha y autor

Ejemplo de entrada nueva:

### Regla: Mapear ID desde hyperlink si ID Interno vacío
*Timestamp:* 2025-11-22 21:00:00  
*Autor:* juan.perez@example.com  

Si la columna "ID Interno" está vacía pero la celda "Folio de trabajo (link)" contiene una URL con patrón /workorder/{id}, extraer {id} y usarlo como ID Interno. Esto ayuda cuando NetSuite no llena ID Interno pero la URL contiene referencia.

Notas de sincronización automática
- No existe actualmente un proceso completamente automático para sincronizar PM_Guía → OT_RULES.md; las actualizaciones requieren intervención manual (copiar/commit).
- Se recomienda que la persona responsable de control de producción resuma cambios críticos y los confirme en el repo.

Dónde guardar este documento
- El archivo OT_RULES.md en la raíz del repo es la versión autorizada para políticas y reglas.
- La hoja PM_Guía en el Spreadsheet es la versión operativa y debe mantenerse sincronizada por el responsable del plan maestro.
