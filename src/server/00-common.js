function PP_appNameFromRequest_(e) {
  const app = String(e && e.parameter && e.parameter.app || 'planning').trim().toLowerCase();
  if (app === 'skills' || app === 'matriz') return 'skills';
  if (app === 'operator' || app === 'operador') return 'operator';
  return 'planning';
}

function PP_appTitle_(appName) {
  if (appName === 'skills') return 'Matriz de habilidades';
  if (appName === 'operator') return 'Plan de operador';
  return 'Planeacion de Produccion';
}

function PP_appHtmlFile_(appName) {
  if (appName === 'skills') return 'IndexSkills';
  if (appName === 'operator') return 'IndexOperator';
  return 'Index';
}
