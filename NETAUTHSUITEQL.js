// ======================================================================
//  NETSUITEOAUTHTEST – Autenticación y Peticiones NetSuite (REST + SuiteQL)
// ======================================================================
//  ✅ Soporte completo para:
//    - REST Record API
//    - REST Query API (SuiteQL)
//  ✅ OAuth 1.0a con HMAC-SHA256
//  ✅ Manejo de errores y respuesta estructurada
//  ✅ Incluye encabezado Prefer: transient para SuiteQL
// ======================================================================

const NetSuiteOAuthTest = (() => {

  // ----------------------------------------------------------
  // CONFIGURACIÓN
  // ----------------------------------------------------------
  const config = {
    accountId: '',
    consumerKey: '',
    consumerSecret: '',
    token: '',
    tokenSecret: ''
  };

  function init(settings) {
    Object.assign(config, settings);
  }

  // ----------------------------------------------------------
  // GENERA CABECERA OAUTH 1.0
  // ----------------------------------------------------------
  function generateHeader(method, url, queryParams = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Utilities.getUuid();

    const oauthParams = {
      oauth_consumer_key: config.consumerKey,
      oauth_token: config.token,
      oauth_signature_method: 'HMAC-SHA256',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0'
    };

    const signingParams = { ...oauthParams, ...queryParams };
    const paramString = Object.keys(signingParams).sort()
      .map(k => `${k}=${encodeURIComponent(signingParams[k])}`)
      .join('&');

    const baseString = [
      method.toUpperCase(),
      encodeURIComponent(url),
      encodeURIComponent(paramString)
    ].join('&');

    const signingKey = `${encodeURIComponent(config.consumerSecret)}&${encodeURIComponent(config.tokenSecret)}`;
    const signatureBytes = Utilities.computeHmacSha256Signature(baseString, signingKey);
    const signature = Utilities.base64Encode(signatureBytes);

    const headerParams = { ...oauthParams, oauth_signature: signature };

    return (
      'OAuth realm="' +
      config.accountId +
      '",' +
      Object.keys(headerParams)
        .map(k => `${k}="${encodeURIComponent(headerParams[k])}"`)
        .join(',')
    );
  }

  // ----------------------------------------------------------
  // PETICIÓN GENERAL (REST o SUITEQL)
  // ----------------------------------------------------------
  function request(method, endpoint, queryParams = {}, body = null) {
    if (!config.accountId)
      throw new Error('⚠️ Debes inicializar NetSuiteOAuthTest.init(settings) antes de usarlo.');

    const url = endpoint.includes('https://')
      ? endpoint
      : `https://${config.accountId.toLowerCase()}.suitetalk.api.netsuite.com${endpoint}`;

    const headers = {
      Authorization: generateHeader(method, url, queryParams),
      'Content-Type': 'application/json'
    };

    // Agregar Prefer: transient si es SuiteQL
    if (endpoint.includes('/suiteql')) {
      headers['Prefer'] = 'transient';
    }

    let finalUrl = url;
    if (queryParams && Object.keys(queryParams).length > 0) {
      finalUrl +=
        '?' +
        Object.keys(queryParams)
          .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
          .join('&');
    }

    const options = {
      method: method.toUpperCase(),
      headers,
      muteHttpExceptions: true
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      options.payload = JSON.stringify(body);
    }

    const response = UrlFetchApp.fetch(finalUrl, options);
    const status = response.getResponseCode();
    const content = response.getContentText();

    let json;
    try {
      json = JSON.parse(content);
    } catch {
      json = content;
    }

    return { status, json, raw: content };
  }

  // ----------------------------------------------------------
  // SUITEQL QUERY – Consulta SQL nativa desde NetSuite
  // ----------------------------------------------------------
  function querySuiteQL(sql) {
    const endpoint = '/services/rest/query/v1/suiteql';
    const body = { q: sql };
    const resp = request('POST', endpoint, {}, body);

    if (resp.status >= 200 && resp.status < 300) {
      return resp.json.items || [];
    } else {
      throw new Error(
        `❌ Error SuiteQL (${resp.status}): ${JSON.stringify(resp.json)}`
      );
    }
  }

  // ----------------------------------------------------------
  // RETORNO DEL MÓDULO
  // ----------------------------------------------------------
  return { init, request, querySuiteQL, generateHeader };

})();
