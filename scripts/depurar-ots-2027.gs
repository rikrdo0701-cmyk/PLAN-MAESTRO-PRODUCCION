// Depura OTs con programa fijo fuera de horizonte (abril 2027):
// quita de lockedOts, limpia LOCKED/AUTO_FROZEN y borra fechas del programa
// en OPERACIONES y ESTADOS_OPERACION_PLAN (ops no completadas).
//
// Fuentes (Project Memory data-sources):
//  - CONFIG.KEY/VALUE -> clave lockedOts (JSON array), revision, savedAt
//  - OPERACIONES: FECHA_INICIO/HORA_INICIO/FECHA_FIN/HORA_FIN/LOCKED/AUTO_FROZEN/ESTATUS/OT
//  - ESTADOS_OPERACION_PLAN: OT/ESTATUS_PLAN/FECHA_*/HORA_*
//  - AUDITORIA: FECHA/USUARIO/ACCION/REVISION/DETALLE
//
// Uso en el editor de Apps Script:
//   depurarOts2027()              // DRY-RUN: solo imprime lo que cambiaria
//   aplicarDepurarOts2027()       // aplica cambios (sin pasar argumentos)
//
// No modifica NetSuite ni RESTlets (RULE-MAT-004).

var TARGET_OT_LIST = ['3413', '3416', '3529', '3533', '2613', '3398'];

function normOt_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toUpperCase()
    .replace(/^O\.?T\.?-?/, '')
    .replace(/[^0-9A-Z]/g, '');
}

function isCompletedStatus_(estatus, estatusPlan) {
  var blob = (String(estatus || '') + ' ' + String(estatusPlan || '')).toUpperCase();
  return /COMPLETAD|HISTORIC|PUBLICAD|CLOSED_KEPT/.test(blob);
}

function columnIndex_(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === name) return i;
  }
  return -1;
}

function readTable_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return { headers: [], rows: [] };
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = values.slice(1).filter(function (row) {
    return row.some(function (cell) { return cell !== '' && cell !== null; });
  });
  return { headers: headers, rows: rows, sheet: sheet };
}

function configGet_(table, key) {
  var keyCol = columnIndex_(table.headers, 'KEY');
  var valCol = columnIndex_(table.headers, 'VALUE');
  if (keyCol < 0 || valCol < 0) return { found: false };
  for (var i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i][keyCol]).trim() === key) {
      return { found: true, rowIndex: i, value: table.rows[i][valCol] };
    }
  }
  return { found: false };
}

function audit_(spreadsheet, accion, detalle) {
  var sheet = spreadsheet.getSheetByName('AUDITORIA');
  if (!sheet) return;
  sheet.appendRow([
    new Date(),
    'script:depurar-ots-2027',
    accion,
    detalle.revision == null ? '' : detalle.revision,
    JSON.stringify(detalle)
  ]);
}

function depurarOts2027(options) {
  var opts = options || {};
  var apply = opts.apply === true;
  var targets = {};
  (opts.ots || TARGET_OT_LIST).forEach(function (ot) { targets[normOt_(ot)] = true; });
  var targetKeys = Object.keys(targets);

  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('PLANNING_SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('Configura PLANNING_SPREADSHEET_ID en Propiedades del script.');
  }
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var report = {
    apply: apply,
    spreadsheetId: spreadsheetId,
    targetOts: targetKeys,
    config: {},
    operaciones: { rowsTouched: 0, byOt: {} },
    estados: { rowsTouched: 0, byOt: {} },
    borrador: { rowsTouched: 0, byOt: {} },
    warnings: []
  };

  // --- CONFIG: lockedOts + revision ---
  var configTable = readTable_(spreadsheet.getSheetByName('CONFIG'));
  var lockedCell = configGet_(configTable, 'lockedOts');
  var revCell = configGet_(configTable, 'revision');
  var savedAtCell = configGet_(configTable, 'savedAt');
  var lockedBefore = [];
  if (lockedCell.found) {
    try { lockedBefore = JSON.parse(String(lockedCell.value) || '[]'); } catch (e) {
      report.warnings.push('lockedOts no es JSON valido: ' + e.message);
    }
  }
  var lockedAfter = lockedBefore.filter(function (ot) { return !targets[normOt_(ot)]; });
  var removedFromLocked = lockedBefore.filter(function (ot) { return targets[normOt_(ot)]; });
  report.config.lockedOtsBefore = lockedBefore;
  report.config.lockedOtsAfter = lockedAfter;
  report.config.removedFromLocked = removedFromLocked;
  var revision = revCell.found ? Number(revCell.value || 0) : 0;
  report.config.revisionBefore = revision;
  report.config.revisionAfter = apply ? revision + 1 : revision + 1;

  // --- OPERACIONES ---
  var opsTable = readTable_(spreadsheet.getSheetByName('OPERACIONES'));
  var otCol = columnIndex_(opsTable.headers, 'OT');
  var estCol = columnIndex_(opsTable.headers, 'ESTATUS');
  var fields = ['FECHA_INICIO', 'HORA_INICIO', 'FECHA_FIN', 'HORA_FIN', 'LOCKED', 'AUTO_FROZEN'];
  var cols = {};
  fields.forEach(function (name) { cols[name] = columnIndex_(opsTable.headers, name); });
  if (otCol < 0) report.warnings.push('OPERACIONES sin columna OT');
  if (apply && configTable.sheet) {
    if (lockedCell.found && cols.LOCKED >= 0) {
      // nada aun: celdas por fila abajo
    }
  }
  if (apply) {
    if (lockedCell.found) {
      configTable.sheet.getRange(lockedCell.rowIndex + 2, columnIndex_(configTable.headers, 'VALUE') + 1)
        .setValue(JSON.stringify(lockedAfter));
    } else {
      report.warnings.push('CONFIG no tiene clave lockedOts');
    }
    if (revCell.found) {
      configTable.sheet.getRange(revCell.rowIndex + 2, columnIndex_(configTable.headers, 'VALUE') + 1)
        .setValue(String(revision + 1));
    }
    if (savedAtCell.found) {
      configTable.sheet.getRange(savedAtCell.rowIndex + 2, columnIndex_(configTable.headers, 'VALUE') + 1)
        .setValue(JSON.stringify(new Date().toISOString()));
    }
  }

  var opsSheet = opsTable.sheet;
  for (var r = 0; r < opsTable.rows.length; r++) {
    var row = opsTable.rows[r];
    var ot = normOt_(row[otCol]);
    if (!targets[ot]) continue;
    if (isCompletedStatus_(row[estCol], '')) {
      report.warnings.push('OPERACIONES OT ' + ot + ' fila ' + (r + 2) + ' completada/historica: se conserva');
      continue;
    }
    var sheetRow = r + 2;
    fields.forEach(function (name) {
      var col = cols[name];
      if (col < 0) return;
      if (!apply) return;
      if (name === 'LOCKED' || name === 'AUTO_FROZEN') {
        opsSheet.getRange(sheetRow, col + 1).setValue(false);
      } else {
        opsSheet.getRange(sheetRow, col + 1).setValue('');
      }
    });
    report.operaciones.rowsTouched += 1;
    report.operaciones.byOt[ot] = (report.operaciones.byOt[ot] || 0) + 1;
  }

  // --- ESTADOS_OPERACION_PLAN ---
  var estTable = readTable_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'));
  var eOtCol = columnIndex_(estTable.headers, 'OT');
  var ePlanCol = columnIndex_(estTable.headers, 'ESTATUS_PLAN');
  var eEstCol = columnIndex_(estTable.headers, 'ESTATUS');
  var eFields = ['FECHA_INICIO', 'HORA_INICIO', 'FECHA_FIN', 'HORA_FIN'];
  var eCols = {};
  eFields.forEach(function (name) { eCols[name] = columnIndex_(estTable.headers, name); });
  if (eOtCol >= 0) {
    for (var er = 0; er < estTable.rows.length; er++) {
      var erow = estTable.rows[er];
      var eot = normOt_(erow[eOtCol]);
      if (!targets[eot]) continue;
      if (isCompletedStatus_(erow[eEstCol], erow[ePlanCol])) continue;
      var esheetRow = er + 2;
      eFields.forEach(function (name) {
        var col = eCols[name];
        if (col < 0 || !apply) return;
        estTable.sheet.getRange(esheetRow, col + 1).setValue('');
      });
      report.estados.rowsTouched += 1;
      report.estados.byOt[eot] = (report.estados.byOt[eot] || 0) + 1;
    }
  } else {
    report.warnings.push('ESTADOS_OPERACION_PLAN sin columna OT');
  }

  // --- BORRADOR_PLAN (solo filas draft con fechas de estas OTs) ---
  var draftTable = readTable_(spreadsheet.getSheetByName('BORRADOR_PLAN'));
  var dOtCol = columnIndex_(draftTable.headers, 'OT');
  var dSnapCol = columnIndex_(draftTable.headers, 'SNAPSHOT_ID');
  var dFields = ['F_INICIO', 'H_INICIO', 'F_FIN', 'H_FIN'];
  var dCols = {};
  dFields.forEach(function (name) { dCols[name] = columnIndex_(draftTable.headers, name); });
  if (dOtCol >= 0) {
    for (var dr = 0; dr < draftTable.rows.length; dr++) {
      var drow = draftTable.rows[dr];
      var dot = normOt_(drow[dOtCol]);
      if (!targets[dot]) continue;
      if (dSnapCol >= 0 && String(drow[dSnapCol]) !== 'draft') continue;
      var dsheetRow = dr + 2;
      dFields.forEach(function (name) {
        var col = dCols[name];
        if (col < 0 || !apply) return;
        draftTable.sheet.getRange(dsheetRow, col + 1).setValue('');
      });
      report.borrador.rowsTouched += 1;
      report.borrador.byOt[dot] = (report.borrador.byOt[dot] || 0) + 1;
    }
  }

  if (apply) {
    report.config.revisionWritten = revision + 1;
    audit_(spreadsheet, 'DEPURAR_OTS_2027', {
      revision: revision + 1,
      targetOts: targetKeys,
      removedFromLocked: removedFromLocked,
      operaciones: report.operaciones,
      estados: report.estados,
      borrador: report.borrador
    });
  }

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function aplicarDepurarOts2027() {
  return depurarOts2027({ apply: true });
}
