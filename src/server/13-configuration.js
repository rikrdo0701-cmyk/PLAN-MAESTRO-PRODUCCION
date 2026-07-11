/**
 * Configura los identificadores no secretos del proyecto.
 * Las credenciales de NetSuite deben agregarse directamente en Propiedades del script.
 */
function configureProductionPlanningProject(settings) {
  settings = settings || {};
  const properties = PropertiesService.getScriptProperties();

  if (settings.spreadsheetId) {
    const spreadsheet = SpreadsheetApp.openById(String(settings.spreadsheetId).trim());
    properties.setProperty('PLANNING_SPREADSHEET_ID', spreadsheet.getId());
    PP_ensureWorkbook_(spreadsheet);
  }

  if (settings.photoFolderId !== undefined) {
    const folderId = String(settings.photoFolderId || '').trim();
    if (folderId) DriveApp.getFolderById(folderId).getName();
    properties.setProperty('PHOTO_FOLDER_ID', folderId);
  }

  return getDeploymentStatus();
}

function setProductionPlanningPhotoFolder(folderId) {
  return configureProductionPlanningProject({ photoFolderId: folderId });
}
