/**
 * DIAGNÓSTICO: Compara tiempo batch vs secuencial para getPlanningWorkOrderData.
 * Ejecutar desde el editor de Apps Script (seleccionar función `runDiagBatchVsSecuencial`).
 * Requiere: ProductionPlanningApp desplegado con credenciales NetSuite configuradas.
 *
 * Uso: seleccionar 2-3 OTs de la hoja ORDENES_TRABAJO o editar `foliosDePrueba` abajo.
 */
function runDiagBatchVsSecuencial() {
  const foliosDePrueba = ['2773', '2774', '2775']; // Editar con OTs reales de tu hoja

  Logger.log('=== DIAGNÓSTICO BATCH vs SECUENCIAL ===');
  Logger.log('OTs a probar: ' + foliosDePrueba.length);
  Logger.log('');

  // 1) Secuencial (comportamiento actual)
  const startSecuencial = Date.now();
  for (let i = 0; i < foliosDePrueba.length; i++) {
    const otStart = Date.now();
    try {
      const result = getPlanningWorkOrderData(foliosDePrueba[i]);
      Logger.log('  [Secuencial] OT ' + foliosDePrueba[i] + ': OK (' + (Date.now() - otStart) + 'ms)');
    } catch (e) {
      Logger.log('  [Secuencial] OT ' + foliosDePrueba[i] + ': FALLO - ' + e.message + ' (' + (Date.now() - otStart) + 'ms)');
    }
  }
  const totalSecuencial = Date.now() - startSecuencial;

  // 2) Batch (nuevo endpoint)
  const startBatch = Date.now();
  try {
    const result = getPlanningWorkOrderDataBatch(foliosDePrueba);
    const totalBatch = Date.now() - startBatch;
    Logger.log('  [Batch] ' + foliosDePrueba.length + ' OTs: OK (' + totalBatch + 'ms)');
    if (result && result.data) {
      Logger.log('  [Batch] Respuestas: ' + result.data.length);
      result.data.forEach(function(item) {
        Logger.log('    - OT ' + item.ot + ': ' + (item.ok ? 'OK' : 'FALLO - ' + item.error));
      });
    }
  } catch (e) {
    Logger.log('  [Batch] FALLO - ' + e.message + ' (' + (Date.now() - startBatch) + 'ms)');
  }
  const totalBatch = Date.now() - startBatch;

  // 3) Resumen
  Logger.log('');
  Logger.log('=== RESUMEN ===');
  Logger.log('Secuencial: ' + totalSecuencial + 'ms (' + foliosDePrueba.length + ' OTs)');
  Logger.log('Batch:      ' + totalBatch + 'ms (' + foliosDePrueba.length + ' OTs)');
  if (totalBatch > 0) {
    Logger.log('Speedup:    ' + (totalSecuencial / totalBatch).toFixed(1) + 'x');
  }
}
