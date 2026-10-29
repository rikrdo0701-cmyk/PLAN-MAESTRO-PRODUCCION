const PP_DEFAULT_FRONTEND_ORIGIN = 'https://rikrdo0701-cmyk.github.io';

function PP_isBridgeRequest_(e) {
  return String(e && e.parameter && e.parameter.app || '').trim().toLowerCase() === 'bridge';
}

function PP_frontendOrigin_() {
  return String(PropertiesService.getScriptProperties().getProperty('FRONTEND_ORIGIN') || PP_DEFAULT_FRONTEND_ORIGIN)
    .trim()
    .replace(/\/$/, '');
}

function PP_createBridgeOutput_() {
  const template = HtmlService.createTemplateFromFile('Bridge');
  template.frontendOrigin = PP_frontendOrigin_();
  return template.evaluate()
    .setTitle('Apps Script Bridge')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setProductionPlanningFrontendOrigin(frontendOrigin) {
  const value = String(frontendOrigin || '').trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(value)) {
    throw new Error('Indica un origen HTTPS sin ruta, por ejemplo https://usuario.github.io');
  }
  PropertiesService.getScriptProperties().setProperty('FRONTEND_ORIGIN', value);
  return { ok: true, frontendOrigin: value };
}
