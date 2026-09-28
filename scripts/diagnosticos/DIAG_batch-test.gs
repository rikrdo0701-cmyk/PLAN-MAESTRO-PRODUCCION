/**
 * PRUEBA DIRECTA del batch endpoint en Apps Script.
 * Ejecutar desde el editor: seleccionar `runDiagBatchTest` y dar click en Ejecutar.
 * No requiere despliegue: usa las credenciales ya configuradas en Properties.
 */
function runDiagBatchTest() {
  const foliosDePrueba = ['2773', '2774', '2775']; // Editar con OTs reales

  Logger.log('=== PRUEBA BATCH: ' + foliosDePrueba.length + ' OTs ===');

  const start = Date.now();
  try {
    const result = getPlanningWorkOrderDataBatch(foliosDePrueba);
    const elapsed = Date.now() - start;

    if (!result || !result.ok) {
      Logger.log('BATCH FALLO: ' + (result && result.error ? result.error : 'error desconocido'));
      return;
    }

    Logger.log('Batch OK en ' + elapsed + 'ms');
    Logger.log('Respuestas: ' + (result.data ? result.data.length : 0));

    if (result.data) {
      result.data.forEach(function(item) {
        if (item.ok) {
          Logger.log('  OT ' + item.ot + ': OK - ' + (item.data && item.data.operations ? item.data.operations.length : 0) + ' operaciones');
        } else {
          Logger.log('  OT ' + item.ot + ': FALLO - ' + item.error);
        }
      });
    }

    // Comparar con secuencial
    Logger.log('');
    Logger.log('=== COMPARACION SECUENCIAL ===');
    const seqStart = Date.now();
    foliosDePrueba.forEach(function(ot) {
      const otStart = Date.now();
      try {
        getPlanningWorkOrderData(ot);
        Logger.log('  OT ' + ot + ': OK (' + (Date.now() - otStart) + 'ms)');
      } catch (e) {
        Logger.log('  OT ' + ot + ': FALLO - ' + e.message + ' (' + (Date.now() - otStart) + 'ms)');
      }
    });
    const seqElapsed = Date.now() - seqStart;

    Logger.log('');
    Logger.log('=== RESUMEN ===');
    Logger.log('Batch:      ' + elapsed + 'ms');
    Logger.log('Secuencial: ' + seqElapsed + 'ms');
    if (elapsed > 0) {
      Logger.log('Speedup:    ' + (seqElapsed / elapsed).toFixed(1) + 'x');
    }
  } catch (e) {
    Logger.log('BATCH EXCEPTION: ' + e.message + ' (' + (Date.now() - start) + 'ms)');
  }
}
