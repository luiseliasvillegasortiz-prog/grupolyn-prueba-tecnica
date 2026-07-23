/**
 * ============================================================
 * FASE 4 (BONUS): Despliegue Masivo del Stub a Clientes
 * ============================================================
 *
 * Estrategia:
 *  1. Recibimos una lista de clientes, cada uno con su Sheet ID
 *     y su Script ID (el Script ID debe capturarse una sola vez
 *     al dar de alta al cliente — ver nota de supuesto abajo).
 *  2. Construimos el contenido del Stub: Code.gs (funciones puente)
 *     + appsscript.json (con la dependencia a la Biblioteca Master).
 *  3. Enviamos ese contenido vía la Apps Script API
 *     (projects.updateContent) usando UrlFetchApp.
 *
 * SUPUESTO IMPORTANTE (validado empíricamente durante pruebas):
 * El spec original asume que basta con la URL/ID del Sheet para
 * ubicar su script vinculado. En la práctica, ni la API de Drive
 * ni la API de Apps Script permiten descubrir el Script ID de un
 * proyecto bound a partir del Spreadsheet ID — es una limitación
 * documentada de la plataforma (confirmado en foros oficiales de
 * Google Apps Script Community: "There is no built-in, programmatic
 * way to get the ID of the Apps Script project file bound to a
 * Sheets file").
 *
 * Por lo tanto, se asume que GrupoLyN mantiene (o captura una sola
 * vez, manualmente, vía Extensiones > Apps Script > Configuración
 * del proyecto) el Script ID de cada cliente al momento de darlo
 * de alta, y el despliegue masivo recibe ambos datos por cliente.
 *
 * IMPORTANTE: Esta función debe ejecutarse desde un script "orquestador"
 * (el tuyo, el del admin), NO desde dentro de cada sheet cliente.
 */

// ID de proyecto de la Biblioteca Master (Apps Script Project ID de la librería)
const MASTER_LIBRARY_SCRIPT_ID = "195EhxLPE8Rz4ooDypVS5M-nTZrMFErDib8lru8ip5De4nY_KVDXGNapw";

// Versión de la librería a usar (puedes usar un número fijo o "HEAD" en modo dev)
const MASTER_LIBRARY_VERSION = 1;

// Identificador con el que se referenciará la librería dentro del script cliente
// (debe coincidir con "MasterLibrary" usado en el Stub)
const MASTER_LIBRARY_IDENTIFIER = "MasterLibrary";

/**
 * Función principal del despliegue masivo.
 * Itera sobre una lista de clientes y les inyecta el Stub.
 *
 * @param {Array<Object>} clients Lista de objetos { sheetId, scriptId }.
 *   sheetId: ID del Spreadsheet del cliente (solo para referencia/logging).
 *   scriptId: ID del proyecto de Apps Script vinculado a ese Sheet.
 */
function deployToClients(clients) {
  const results = [];

  clients.forEach(function (client) {
    const sheetId = client.sheetId;
    const scriptId = client.scriptId;

    try {
      if (!scriptId) {
        results.push({ sheetId: sheetId, status: "ERROR", detail: "No se proporcionó scriptId para este cliente." });
        return;
      }

      injectStub(scriptId);

      results.push({ sheetId: sheetId, scriptId: scriptId, status: "OK" });
    } catch (error) {
      results.push({ sheetId: sheetId, scriptId: scriptId, status: "ERROR", detail: error.message });
    }
  });

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

/**
 * Inyecta (sobreescribe) el contenido del Stub en el proyecto de Apps Script
 * indicado, usando la Apps Script API (projects.updateContent).
 *
 * ADVERTENCIA: updateContent REEMPLAZA todo el contenido del proyecto.
 * Si el cliente ya tenía código propio, se perderá. Para producción,
 * considera primero hacer un backup con projects.getContent().
 *
 * @param {string} scriptId ID del proyecto de Apps Script del cliente.
 */
function injectStub(scriptId) {
  // Requiere el scope: https://www.googleapis.com/auth/script.projects
  // Endpoint correcto confirmado: termina en "/content", NO en ":updateContent"
  const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";

  const payload = {
    files: [
      {
        name: "Code",
        type: "SERVER_JS",
        source: buildStubSource()
      },
      {
        name: "appsscript",
        type: "JSON",
        source: buildStubManifest()
      }
    ]
  };

  const response = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken()
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error("Fallo al actualizar el script " + scriptId + ": " + response.getContentText());
  }
}

/**
 * Genera el código fuente (Code.gs) que se inyectará en cada cliente.
 * Es un "puente" que delega toda la lógica real a la Biblioteca Master.
 *
 * @return {string} Código fuente del Stub.
 */
function buildStubSource() {
  return [
    "/**",
    " * Stub generado automáticamente. Toda la lógica vive en la Biblioteca Master.",
    " * No editar manualmente: los cambios se sobreescriben en cada despliegue.",
    " */",
    "",
    "function onOpen(e) {",
    "  " + MASTER_LIBRARY_IDENTIFIER + ".onOpen(e);",
    "}",
    "",
    "function promptAdminLogin() {",
    "  " + MASTER_LIBRARY_IDENTIFIER + ".promptAdminLogin();",
    "}",
    "",
    "function generateReport() {",
    "  " + MASTER_LIBRARY_IDENTIFIER + ".generateReport();",
    "}"
  ].join("\n");
}

/**
 * Genera el manifiesto appsscript.json del script cliente, incluyendo
 * la dependencia hacia la Biblioteca Master y los scopes que ESA
 * biblioteca necesita en tiempo de ejecución (Gmail, Cache, etc.).
 *
 * @return {string} Contenido JSON (como string) del manifiesto.
 */
function buildStubManifest() {
  const manifest = {
    timeZone: "America/Mexico_City",
    dependencies: {
      libraries: [
        {
          userSymbol: MASTER_LIBRARY_IDENTIFIER,
          libraryId: MASTER_LIBRARY_SCRIPT_ID,
          version: String(MASTER_LIBRARY_VERSION),
          developmentMode: false
        }
      ]
    },
    exceptionLogging: "STACKDRIVER",
    runtimeVersion: "V8",
    // Estos scopes deben cubrir lo que la librería necesita ejecutar
    // (SpreadsheetApp, CacheService, GmailApp, etc.) dentro del contexto del cliente.
    oauthScopes: [
      "https://www.googleapis.com/auth/spreadsheets.currentonly",
      "https://www.googleapis.com/auth/script.container.ui",
      "https://www.googleapis.com/auth/gmail.compose"
    ]
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * Función temporal SOLO para pruebas manuales desde el editor.
 * Ejecuta el despliegue contra el Sheet cliente falso, ya con
 * su Script ID conocido (capturado manualmente para esta prueba).
 */
function testDeployToOneClient() {
  const testClient = {
    sheetId: "12OVDjqEAXUjjyEPBttJmvTLcOMQ7BSIAMwASO0OD3ZY",
    scriptId: "159nVQtlTqCtlsZDSBy4EfbqMzY_rdrLYYD7gXilSh5nvMKPbjfwBtmiP"
  };

  const result = deployToClients([testClient]);
  Logger.log(JSON.stringify(result, null, 2));
}
