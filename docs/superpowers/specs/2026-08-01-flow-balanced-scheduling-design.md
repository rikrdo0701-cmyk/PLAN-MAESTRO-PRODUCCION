# Diseño de programación FLOW_BALANCED

## Objetivo

Reducir el tiempo que una OT permanece en proceso y aprovechar mejor los recursos disponibles, sin eliminar ni debilitar ninguna restricción del motor actual.

## Compatibilidad

- Mantener precedencias, calendarios, capacidades finitas/no finitas, solapamientos, operaciones bloqueadas y completadas, exclusiones, habilidades, máquinas, subcontratos y herramentales.
- Conservar todas las estrategias actuales y comparar sus resultados contra `FLOW_BALANCED`.
- Elegir la nueva estrategia solo si mejora la puntuación común; ante empate, conservar la estrategia actual.
- Control configurable `flowBalancedEnabled`, activado por defecto y reversible sin migrar datos.

## Estrategia

`FLOW_BALANCED` utiliza una cola de operaciones listas por recurso. En cada liberación selecciona la mejor operación elegible mediante este orden:

1. OT atrasada o con menor holgura.
2. OT ya iniciada y más próxima a terminar.
3. Operación que desbloquea la mayor carga sucesora.
4. Operación que aprovecha el hueco sin retrasar una OT más urgente.
5. Menor cambio de máquina, herramental y kit.

El límite de trabajo en proceso es flexible. `flowWipTarget`, inicialmente `10`, penaliza abrir OTs adicionales, pero permite hacerlo cuando ningún trabajo de una OT abierta puede usar el recurso libre.

## Balance de recursos

Cuando varios operadores autorizados pueden ejecutar una operación, se elige el que tenga menor carga proyectada dentro del horizonte. La decisión respeta rendimiento individual, categoría, disponibilidad, matriz de habilidades y capacidad de máquina.

No se intenta igualar artificialmente porcentajes entre recursos con habilidades diferentes.

## Puntuación común

Cada plan se evalúa con componentes normalizados:

- 45% tardanza ponderada por prioridad.
- 30% tiempo de flujo: primera operación hasta última operación de cada OT.
- 15% huecos ociosos evitables en recursos con trabajo elegible.
- 10% cambios de herramental.

Las violaciones de restricciones continúan siendo inválidas, no penalizaciones negociables.

## Interfaz

En configuración del plan se muestran:

- `Priorizar flujo y balance` (`flowBalancedEnabled`).
- `OTs simultáneas objetivo` (`flowWipTarget`, rango 1–50, valor inicial 10).

El resultado informa estrategia seleccionada, tiempo promedio de flujo, OTs abiertas máximas, horas ociosas evitables, cambios de herramental y utilización por recurso. No agrega OTs del backlog automáticamente; solo puede sugerir candidatas en una fase posterior.

## Seguridad y rendimiento

- Reutilizar las estructuras e intervalos del programador actual.
- Limitar `FLOW_BALANCED` a una evaluación adicional dentro del máximo actual de estrategias.
- Si falla, registrar diagnóstico y continuar con las estrategias existentes.
- No tocar el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.

## Pruebas de aceptación

- Todos los casos actuales producen un plan válido y mantienen sus pruebas.
- En un escenario con recursos alternativos, baja la diferencia de carga sin aumentar tardanza.
- En un escenario con muchas OTs cortas, reduce el flujo promedio y el WIP máximo.
- Un recurso libre puede abrir otra OT si las OTs activas no tienen trabajo elegible.
- Desactivar `flowBalancedEnabled` reproduce la selección de estrategias anterior.
- Bloqueos, precedencias, operaciones completadas, exclusiones y herramentales permanecen intactos.
