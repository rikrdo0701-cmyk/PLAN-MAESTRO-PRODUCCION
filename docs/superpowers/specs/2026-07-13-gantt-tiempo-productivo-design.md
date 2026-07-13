# Gantt con tiempo productivo e intervalo real

## Objetivo

Representar cada operación con dos medidas independientes:

- **Tiempo productivo:** minutos configurados que consumen capacidad.
- **Intervalo real:** periodo continuo entre la fecha/hora de inicio y la fecha/hora de fin, incluyendo pausas, horarios fuera de turno y días no laborables.

## Reglas funcionales

1. El motor consume la duración productiva solamente dentro de ventanas operativas.
2. Una interrupción del calendario desplaza la fecha de fin, sin aumentar el tiempo productivo.
3. La barra del Gantt comienza en el inicio real y termina en el fin real; por tanto cubre visualmente las interrupciones intermedias.
4. La etiqueta visible de la barra muestra únicamente los minutos productivos, por ejemplo `20 min productivos`.
5. El texto emergente muestra:
   - OT, secuencia, CT y operador;
   - tiempo productivo;
   - tiempo no operativo;
   - fecha y hora reales de inicio y fin.
6. El tiempo no operativo se calcula como `intervalo real - tiempo productivo`, nunca menor que cero.
7. Las cargas y reportes de producción siguen usando el tiempo productivo; no contabilizan noches, pausas ni días no laborables.

## Ejemplos de aceptación

### Pausa dentro del turno

- Operación: 20 minutos productivos.
- Inicio: 14:50.
- Periodo no operativo: 15:00–15:05.
- Fin: 15:15.
- Barra: 14:50–15:15.
- Etiqueta: `20 min productivos`.
- Texto emergente: 20 minutos productivos y 5 minutos no operativos.

### Fin de semana

- Horario laboral: lunes a viernes, 07:00–17:00.
- Sábado y domingo: no operativos.
- Operación: 20 minutos productivos.
- Inicio: viernes 16:50.
- Fin: lunes 07:10.
- Barra: cubre el intervalo completo entre viernes y lunes.
- Etiqueta: `20 min productivos`.
- Texto emergente: muestra por separado los minutos productivos y los minutos no operativos.

## Componentes afectados

- `planner-core.js`: se preserva la asignación segmentada por calendario y se cubre con pruebas de regresión.
- `app.js`: la barra usa `operationDuration(op)` como duración productiva y la diferencia entre fechas únicamente para calcular el tiempo no operativo y el ancho visual.
- Pruebas del motor y del build: validan ambos ejemplos y la separación de medidas en el Gantt.

## Manejo de casos límite

- Si las fechas son inválidas o el fin precede al inicio, no se muestra tiempo no operativo negativo.
- Las operaciones de subcontrato mantienen sus reglas propias de días hábiles.
- Los cambios de herramental siguen la misma separación entre duración productiva e intervalo real.
- El horizonte visible recorta la barra en pantalla, pero no altera las fechas almacenadas.

## Fuera de alcance

- Dividir una barra en segmentos productivos y no operativos con colores diferentes.
- Cambiar el calendario o la escala diaria del Gantt a una vista de 24 horas.
- Modificar la lógica aprobada de cálculo de TC por piezas.

## Verificación

- Prueba del motor para una pausa de cinco minutos.
- Prueba del motor para una operación que cruza un fin de semana.
- Prueba del build para la etiqueta `min productivos` y el texto `min no operativos`.
- Pruebas completas y build estático.
- QA del Gantt en navegador sin errores de consola.
