# Prueba Técnica – GrupoLyN

Plataforma: Google Sheets + Apps Script.

Este repositorio contiene el código de Apps Script desarrollado para la prueba técnica de GrupoLyN: menú "Admin" con control de acceso, generación de un reporte comparativo mensual, y un script de despliegue masivo (bonus) que inyecta esta funcionalidad en copias de clientes vía la Apps Script API.

## Contenido

| Archivo | Fase | Descripción |
|---|---|---|
| `Codigo.gs` | 1, 2 y 3 | Menú Admin con control de acceso, lógica del reporte comparativo mensual, y exportación a borrador de Gmail. |
| `Deploy.gs` | 4 (bonus) | Despliegue masivo del menú Admin a copias de clientes, publicando este proyecto como Biblioteca y usando la Apps Script API para inyectar el código en cada cliente. |
| `appsscript.json` | — | Manifiesto de referencia del proyecto (dependencias y scopes de OAuth necesarios). |

## Resumen del enfoque

Este proyecto se publica como una **Biblioteca de Apps Script** ("Master Library"), que concentra toda la lógica de negocio. Cada copia de cliente recibe únicamente un pequeño "stub" que delega las llamadas (`onOpen`, `promptAdminLogin`, `generateReport`) a esta librería compartida. Esto permite actualizar la lógica en un solo lugar y propagarla a todos los clientes sin editar cada copia manualmente.

## Fase 1 — Menú Admin con control de acceso

- El menú se reconstruye en cada apertura del archivo (`onOpen`), mostrando un estado bloqueado o desbloqueado según una bandera guardada en `CacheService` (vigencia de 2 horas).
- Estado bloqueado: única opción "🔑 Desbloquear Acceso", que solicita la contraseña de administrador vía `ui.prompt`.
- Al validarla correctamente, se reconstruye el menú mostrando las opciones de administrador.

## Fases 2 y 3 — Reporte Comparativo Mensual

- Lee la pestaña `Monthly Budget` e identifica la jerarquía de datos según la columna en la que aparece cada texto, ya que la hoja no tiene columnas separadas de categoría/sub-categoría dedicadas: columna A = sección (ej. "Income", "Expenses & Debt Service"), columna B = categoría principal (ej. "Shelter", "Grocery") o su cierre ("Total X"), columna C = concepto individual (ej. "Mortgage").
- Solo procesa la sección "Expenses & Debt Service" (se enfoca en sobregiros de gasto, no de ingreso).
- Calcula el total planificado vs. real por categoría y marca una desviación como significativa a partir de **15%** (`DEVIATION_THRESHOLD`).
- Para las categorías sobregiradas, lista los conceptos individuales responsables con su monto real vs. planificado.
- La salida se entrega como un **borrador de Gmail** (`GmailApp.createDraft`) en formato HTML, listo para revisar y enviar al cliente.

## Fase 4 (Bonus) — Despliegue masivo a clientes

### Hallazgo importante durante las pruebas

El enunciado asume que basta con la URL de cada Google Sheet cliente para ubicar y actualizar su proyecto de Apps Script vinculado. Al validar esto de forma práctica, se confirmó una limitación real de la plataforma: **ni la API de Drive ni la API de Apps Script permiten descubrir el Script ID de un proyecto vinculado (bound script) a partir del ID del Spreadsheet.** Esto está confirmado en foros oficiales de Google Apps Script Community.

Por esta razón, `deployToClients()` recibe una lista de objetos `{ sheetId, scriptId }` en lugar de solo URLs, asumiendo que GrupoLyN captura y mantiene el Script ID de cada cliente al momento de darlo de alta.

### Cómo funciona

1. Este proyecto se publica como **Biblioteca** de Apps Script (Script ID + versión estables).
2. `deployToClients(clients)` itera sobre la lista de clientes y llama `injectStub(scriptId)` para cada uno.
3. `injectStub()` usa la Apps Script API (`PUT /v1/projects/{scriptId}/content`) para sobreescribir el contenido del proyecto cliente con:
   - Un `Code.gs` "stub" que delega a la librería.
   - Un `appsscript.json` con la dependencia declarada hacia la Biblioteca Master.
4. El resultado de cada cliente se registra (`OK` o `ERROR` con detalle), permitiendo auditar despliegues masivos sin que un fallo individual detenga el resto del lote.

### Validación realizada

Se probó el flujo completo contra un cliente de prueba real (no solo en diseño): publicación de la librería, creación de un Sheet cliente de prueba, configuración de un proyecto de Google Cloud estándar (necesario porque el proyecto de GCP "gestionado por Google" por defecto no permite habilitar las APIs necesarias), ejecución de `deployToClients()` con respuesta 200 OK, y confirmación visual de que el menú Admin, la autenticación y el reporte (con su manejo de errores) funcionan correctamente en el cliente de prueba.

### Limitaciones conocidas para producción

- `projects.updateContent` reemplaza todo el contenido del proyecto cliente; en producción convendría primero leer el contenido existente (`projects.getContent`) y fusionar en vez de sobreescribir a ciegas.
- El manifiesto inyectado no preserva dependencias previas del cliente (habría que fusionar el arreglo de `libraries` en vez de reemplazarlo).

## Documento de entrega

El detalle completo del enfoque, los supuestos y la evidencia de las pruebas realizadas está en el documento `Documento_Entrega_GrupoLyN.docx`, incluido en la carpeta de Google Drive de la entrega.
