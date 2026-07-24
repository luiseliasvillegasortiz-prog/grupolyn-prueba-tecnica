/**
 * ============================================================
 * FASE 1: Menú Admin con control de acceso
 * ============================================================
 */

// Clave de acceso (hardcodeada solo para esta fase de prueba)
const ADMIN_PASSWORD = "admin123";

// Nombre de la clave en caché para identificar sesión desbloqueada
const CACHE_KEY_ADMIN = "admin_unlocked";

// Duración del desbloqueo en segundos (2 horas)
const CACHE_DURATION_SECONDS = 2 * 60 * 60;

/**
 * Se ejecuta automáticamente al abrir la hoja de cálculo.
 * Construye el menú "Admin" según el estado de acceso del usuario.
 */
function onOpen(e) {
  const cache = CacheService.getUserCache();
  const isUnlocked = cache.get(CACHE_KEY_ADMIN) === "true";

  if (isUnlocked) {
    buildUnlockedMenu();
  } else {
    buildLockedMenu();
  }
}

/**
 * Construye el menú "Admin" en su estado bloqueado (por defecto).
 * Solo muestra la opción para ingresar la contraseña.
 */
function buildLockedMenu() {
  SpreadsheetApp.getUi()
    .createMenu("Admin")
    .addItem("🔑 Desbloquear Acceso", "promptAdminLogin")
    .addToUi();
}

/**
 * Construye el menú "Admin" en su estado desbloqueado.
 * Reemplaza el menú existente agregando las opciones de administrador
 * y quitando la opción de desbloqueo.
 */
function buildUnlockedMenu() {
  SpreadsheetApp.getUi()
    .createMenu("Admin")
    .addItem("📄 Generar Reporte Comparativo", "generateReport")
    .addToUi();
}

/**
 * Muestra un prompt solicitando la contraseña de administrador.
 * Si la clave es correcta, guarda el flag en caché y actualiza el menú.
 * Si es incorrecta, muestra un alert de error.
 */
function promptAdminLogin() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    "Acceso de Administrador",
    "Ingresa la contraseña para desbloquear las opciones de Admin:",
    ui.ButtonSet.OK_CANCEL
  );

  // Si el usuario canceló el prompt, no hacemos nada más
  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const enteredPassword = response.getResponseText().trim();

  if (enteredPassword === ADMIN_PASSWORD) {
    // Contraseña correcta: guardamos el flag en caché por 2 horas
    const cache = CacheService.getUserCache();
    cache.put(CACHE_KEY_ADMIN, "true", CACHE_DURATION_SECONDS);

    // Reconstruimos el menú con las opciones desbloqueadas
    buildUnlockedMenu();

    ui.alert("✅ Acceso concedido. El menú Admin ha sido actualizado.");
  } else {
    // Contraseña incorrecta
    ui.alert("❌ Contraseña incorrecta. Inténtalo de nuevo.");
  }
}

/**
 * Genera el reporte comparativo mensual y lo envía como borrador de Gmail.
 */
function generateReport() {
  const ui = SpreadsheetApp.getUi();

  try {
    const groupedData = getGroupedBudgetData();
    Logger.log("Categorías detectadas: " + Object.keys(groupedData).join(", "));
    const reportData = buildReportData(groupedData);

    createReportDraft(reportData);
  } catch (error) {
    ui.alert("❌ Error al generar el reporte: " + error.message);
    Logger.log(error);
  }
}

/**
 * ============================================================
 * FASE 2: Lógica del Reporte Comparativo
 * ============================================================
 * Ajustada a la estructura real de "Monthly Budget":
 * - No hay columnas separadas para Categoría/Sub-categoría dedicadas.
 * - La jerarquía se identifica por la COLUMNA en la que aparece el texto:
 *     Columna A -> Sección (ej. "Income", "Expenses & Debt Service") - se ignora como agrupador
 *     Columna B -> Categoría (ej. "Shelter", "Person 1") o su cierre ("Total X")
 *     Columna C -> Concepto individual dentro de la categoría actual
 * - Solo se procesan categorías dentro de la sección "Expenses & Debt Service".
 */

const SHEET_NAME_BUDGET = "Monthly Budget";
const DEVIATION_THRESHOLD = 0.15;

// Índices de columnas (0-based) según el layout real de la hoja
const COL_DESCRIPTION = 2; // Columna C
const COL_PLANNED = 3;     // Columna D
const COL_ACTUAL = 5;      // Columna F

// Fila donde empiezan los datos reales (después de los encabezados)
const START_ROW = 7; // fila 7 en la hoja = índice 6 en el array (values[6])

/**
 * Lee la hoja "Monthly Budget" y construye el objeto agrupado por categoría.
 * Solo procesa categorías dentro de la sección "Expenses & Debt Service",
 * ignorando las categorías de Ingreso (Person 1, Person 2, Other Income),
 * ya que el reporte debe enfocarse en sobregiros de GASTO, según el spec.
 *
 * @return {Object} Mapa { categoria: [ { subCategory, planned, actual }, ... ] }
 */
function getGroupedBudgetData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_BUDGET);

  if (!sheet) {
    throw new Error("No se encontró la pestaña '" + SHEET_NAME_BUDGET + "'.");
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  const EXPENSE_SECTION_NAME = "Expenses & Debt Service";
  const INCOME_SECTION_NAME = "Income";

  const grouped = {};
  let currentCategory = null;
  let inExpenseSection = false;

  for (let i = START_ROW - 1; i < values.length; i++) {
    const sectionText = String(values[i][0] || "").trim();  // Columna A
    const categoryText = String(values[i][1] || "").trim(); // Columna B
    const itemText = String(values[i][2] || "").trim();     // Columna C

    if (sectionText) {
      if (sectionText === EXPENSE_SECTION_NAME) {
        inExpenseSection = true;
      } else if (sectionText === INCOME_SECTION_NAME) {
        inExpenseSection = false;
      }
      currentCategory = null;
      continue;
    }

    if (!inExpenseSection) {
      continue;
    }

    if (categoryText) {
      if (categoryText.indexOf("Total") === 0) {
        currentCategory = null;
      } else {
        currentCategory = categoryText;
        if (!grouped[currentCategory]) {
          grouped[currentCategory] = [];
        }
      }
      continue;
    }

    if (itemText && currentCategory) {
      const planned = Number(values[i][COL_PLANNED]) || 0;
      const actual = Number(values[i][COL_ACTUAL]) || 0;

      grouped[currentCategory].push({
        subCategory: itemText,
        planned: planned,
        actual: actual
      });
    }
  }

  return grouped;
}

/**
 * Construye la estructura final del reporte a partir de los datos agrupados.
 */
function buildReportData(groupedData) {
  const reportData = [];

  Object.keys(groupedData).forEach(function (category) {
    const items = groupedData[category];

    if (items.length === 0) {
      return;
    }

    const totals = calculateCategoryTotals(items);
    const deviation = calculateDeviation(totals.totalPlanned, totals.totalActual);
    const isOverBudget = Math.abs(deviation) >= DEVIATION_THRESHOLD;

    const categoryReport = {
      category: category,
      totalPlanned: totals.totalPlanned,
      totalActual: totals.totalActual,
      deviation: deviation,
      isOverBudget: isOverBudget,
      overrunSubCategories: []
    };

    if (isOverBudget) {
      categoryReport.overrunSubCategories = findOverrunSubCategories(items);
    }

    reportData.push(categoryReport);
  });

  return reportData;
}

function calculateCategoryTotals(items) {
  let totalPlanned = 0;
  let totalActual = 0;

  items.forEach(function (item) {
    totalPlanned += item.planned;
    totalActual += item.actual;
  });

  return { totalPlanned: totalPlanned, totalActual: totalActual };
}

function calculateDeviation(totalPlanned, totalActual) {
  if (totalPlanned === 0) {
    return totalActual === 0 ? 0 : 1;
  }
  return (totalActual - totalPlanned) / totalPlanned;
}

function findOverrunSubCategories(items) {
  return items
    .filter(function (item) {
      return item.actual > item.planned;
    })
    .map(function (item) {
      return {
        subCategory: item.subCategory,
        planned: item.planned,
        actual: item.actual,
        overAmount: item.actual - item.planned
      };
    });
}

/**
 * ============================================================
 * FASE 3: Exportación del Reporte (Gmail)
 * ============================================================
 */

// Destinatario dummy para el borrador (ajustar en producción)
const REPORT_RECIPIENT = "cliente@ejemplo.com";

/**
 * Toma la estructura de reportData y crea un borrador en Gmail
 * con el detalle de las categorías que superaron el presupuesto.
 *
 * @param {Array<Object>} reportData Estructura generada por buildReportData()
 */
function createReportDraft(reportData) {
  const ui = SpreadsheetApp.getUi();

  const overBudgetCategories = reportData.filter(function (item) {
    return item.deviation >= DEVIATION_THRESHOLD;
  });

  const subject = "Reporte Comparativo de Presupuesto Mensual";
  let htmlBody;

  if (overBudgetCategories.length === 0) {
    htmlBody = buildOkBody();
  } else {
    htmlBody = buildOverBudgetBody(overBudgetCategories);
  }

  GmailApp.createDraft(REPORT_RECIPIENT, subject, "", {
    htmlBody: htmlBody
  });

  ui.alert("Borrador de reporte generado exitosamente en Gmail.");
}

/**
 * Cuerpo del correo cuando NO hay desviaciones significativas.
 */
function buildOkBody() {
  return "<p>Presupuesto bajo control. No hay desviaciones significativas.</p>";
}

/**
 * Cuerpo del correo cuando SÍ hay una o más categorías sobregiradas.
 */
function buildOverBudgetBody(overBudgetCategories) {
  let body = "<p>Se detectaron las siguientes desviaciones en el presupuesto mensual:</p>";

  overBudgetCategories.forEach(function (categoryReport) {
    body += buildCategoryBlock(categoryReport);
  });

  return body;
}

/**
 * Construye el bloque HTML correspondiente a una sola categoría sobregirada.
 */
function buildCategoryBlock(categoryReport) {
  const deviationPercent = (categoryReport.deviation * 100).toFixed(1);

  let block = "<p><strong>" + categoryReport.category + "</strong> está por encima del "
    + "presupuesto en un " + deviationPercent + "%.</p>";

  if (categoryReport.overrunSubCategories.length > 0) {
    block += "<p>Conceptos responsables:</p>";
    block += "<ul>";

    categoryReport.overrunSubCategories.forEach(function (sub) {
      block += "<li>" + sub.subCategory + ": $" + formatCurrency(sub.actual)
        + " (Actual) vs $" + formatCurrency(sub.planned) + " (Planned)</li>";
    });

    block += "</ul>";
  }

  return block;
}

/**
 * Formatea un número como moneda simple (2 decimales).
 */
function formatCurrency(value) {
  return Number(value).toFixed(2);
}
