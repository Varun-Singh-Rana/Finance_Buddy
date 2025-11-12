const database = require("../../electron/db");

const dependencyError = database.dependencyError;

const state = {
  profile: null,
  reports: [],
  metrics: {
    totalReports: 0,
    totalTrend: "No reports yet",
    averageSpending: 0,
    averageTrend: "Add transactions to unlock",
    totalSavings: 0,
    savingsTrend: "Net income minus expenses this year",
  },
};

const elements = {
  greeting: null,
  avatar: null,
  status: null,
  generateBtn: null,
  customBtn: null,
  totalReports: null,
  totalTrend: null,
  avgSpending: null,
  avgTrend: null,
  totalSavings: null,
  savingsTrend: null,
  list: null,
};

let locale;
let currencyFormatter;
let monthFormatter;
let fullDateFormatter;

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  attachEvents();

  locale = getLocale();
  currencyFormatter = createCurrencyFormatter(locale);
  monthFormatter = createMonthFormatter(locale);
  fullDateFormatter = createFullDateFormatter(locale);

  if (dependencyError) {
    showStatus(
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`,
      "error"
    );
    disableButtons();
    return;
  }

  await loadProfile();
  await refreshData();
});

function cacheElements() {
  elements.greeting = document.getElementById("report-greeting");
  elements.avatar = document.getElementById("report-avatar");
  elements.status = document.getElementById("report-status");
  elements.generateBtn = document.getElementById("generateReportBtn");
  elements.customBtn = document.getElementById("customReportBtn");
  elements.totalReports = document.getElementById("metric-total-reports");
  elements.totalTrend = document.getElementById("metric-total-trend");
  elements.avgSpending = document.getElementById("metric-avg-spending");
  elements.avgTrend = document.getElementById("metric-avg-trend");
  elements.totalSavings = document.getElementById("metric-total-savings");
  elements.savingsTrend = document.getElementById("metric-savings-trend");
  elements.list = document.getElementById("report-list");
}

function attachEvents() {
  elements.generateBtn?.addEventListener("click", handleGenerateReport);
  elements.customBtn?.addEventListener("click", () =>
    showStatus("Custom report builder is on the roadmap.", "info")
  );
  elements.list?.addEventListener("click", (event) => {
    const button = event.target.closest(".download-btn");
    if (!button) {
      return;
    }
    const report = state.reports.find(
      (entry) => String(entry.id) === button.dataset.id
    );
    if (!report) {
      return;
    }
    showStatus(
      `Download for "${report.title}" will be available in a future update.`,
      "info"
    );
  });
}

async function refreshData() {
  try {
    await ensureReportTable();
    await loadReports();
    await loadMetrics();
    renderMetrics();
    renderReportList();

    if (!state.reports.length) {
      showStatus(
        "No reports generated yet. Use the button above to create one.",
        "info"
      );
    } else {
      clearStatus();
    }
  } catch (error) {
    console.error("Finlytics reports: unable to load data", error);
    showStatus(
      `Unable to load reports: ${database.normalizeDbError(error)}`,
      "error"
    );
  }
}

async function loadProfile() {
  try {
    const profile = await database.getUserProfile();
    state.profile = profile;
    const fullName = profile?.full_name?.trim();
    if (fullName && elements.greeting) {
      elements.greeting.textContent = `Welcome back, ${fullName}`;
    }
    if (fullName && elements.avatar) {
      elements.avatar.textContent = fullName.charAt(0).toUpperCase() || "F";
    }
  } catch (error) {
    console.warn("Finlytics reports: unable to load user profile", error);
  }
}

async function ensureReportTable() {
  await database.query(`
    CREATE TABLE IF NOT EXISTS report_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      report_type TEXT NOT NULL,
      file_format TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      summary TEXT,
      generated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function loadReports() {
  const result = await database.query(
    `SELECT id, title, report_type, file_format, period_start, period_end, summary, generated_at
     FROM report_history
     ORDER BY datetime(generated_at) DESC
     LIMIT 30;`
  );

  state.reports = (result.rows || []).map((row) => ({
    id: row.id,
    title: row.title,
    type: row.report_type,
    format: row.file_format,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    summary: row.summary || "",
    generatedAt: row.generated_at,
    periodLabel: formatPeriod(
      row.period_start,
      row.period_end,
      row.generated_at
    ),
    monthKey: extractMonthKey(row.generated_at),
  }));
}

async function loadMetrics() {
  const [spendingResult, savingsResult] = await Promise.all([
    database.query(
      `SELECT strftime('%Y-%m', occurred_at) AS period,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
       FROM "transaction"
       WHERE occurred_at >= date('now', '-6 months')
       GROUP BY period
       ORDER BY period;`
    ),
    database.query(
      `SELECT SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
       FROM "transaction"
       WHERE strftime('%Y', occurred_at) = strftime('%Y', 'now');`
    ),
  ]);

  const monthlyExpenses = (spendingResult.rows || []).map((row) => ({
    period: row.period,
    expense: toNumber(row.expense),
  }));

  const averageSpending = monthlyExpenses.length
    ? monthlyExpenses.reduce((sum, row) => sum + row.expense, 0) /
      monthlyExpenses.length
    : 0;

  const latestExpense = monthlyExpenses.length
    ? monthlyExpenses[monthlyExpenses.length - 1].expense
    : 0;
  const previousExpense =
    monthlyExpenses.length > 1
      ? monthlyExpenses[monthlyExpenses.length - 2].expense
      : 0;
  const expenseTrend = computePercentChange(latestExpense, previousExpense);

  const incomeTotal = toNumber(savingsResult.rows?.[0]?.income);
  const expenseTotal = toNumber(savingsResult.rows?.[0]?.expense);
  const netSavings = roundCurrency(incomeTotal - expenseTotal);
  const savingsTrend =
    netSavings >= 0 ? "Income ahead of expenses" : "Spending exceeds income";

  const currentMonthKey = extractMonthKey(new Date());
  const recentCount = state.reports.filter(
    (report) => report.monthKey === currentMonthKey
  ).length;

  state.metrics = {
    totalReports: state.reports.length,
    totalTrend: recentCount
      ? `${recentCount} generated this month`
      : "No reports this month",
    averageSpending: roundCurrency(averageSpending),
    averageTrend:
      monthlyExpenses.length > 1
        ? `${formatPercentChange(expenseTrend)} vs prior month`
        : "Need more history",
    totalSavings: netSavings,
    savingsTrend,
  };
}

async function handleGenerateReport(event) {
  const button = event.currentTarget;
  if (!button) {
    return;
  }

  button.disabled = true;
  const originalLabel = button.innerHTML;
  button.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>Generating...</span>`;

  try {
    const now = new Date();
    const title = `Monthly Snapshot - ${monthFormatter.format(now)}`;
    const periodStart = formatDateForSql(
      new Date(now.getFullYear(), now.getMonth(), 1)
    );
    const periodEnd = formatDateForSql(
      new Date(now.getFullYear(), now.getMonth() + 1, 0)
    );

    await database.query(
      `INSERT INTO report_history (title, report_type, file_format, period_start, period_end, summary)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        title,
        "summary",
        "PDF",
        periodStart,
        periodEnd,
        "Auto-generated monthly summary with income, expense, and savings highlights.",
      ]
    );

    showStatus(
      "Report saved. You can download it from the list below.",
      "success"
    );
    await refreshData();
  } catch (error) {
    console.error("Finlytics reports: generate failed", error);
    showStatus(
      `Unable to create report: ${database.normalizeDbError(error)}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

function renderMetrics() {
  if (elements.totalReports) {
    elements.totalReports.textContent = String(
      state.metrics.totalReports
    ).padStart(2, "0");
  }
  if (elements.totalTrend) {
    elements.totalTrend.textContent = state.metrics.totalTrend;
    updateTrendClass(elements.totalTrend, state.metrics.totalReports > 0);
  }

  if (elements.avgSpending) {
    elements.avgSpending.textContent = formatCurrency(
      state.metrics.averageSpending
    );
  }
  if (elements.avgTrend) {
    elements.avgTrend.textContent = state.metrics.averageTrend;
    updateTrendClass(
      elements.avgTrend,
      !state.metrics.averageTrend.includes("-")
    );
  }

  if (elements.totalSavings) {
    elements.totalSavings.textContent = formatCurrency(
      state.metrics.totalSavings
    );
  }
  if (elements.savingsTrend) {
    elements.savingsTrend.textContent = state.metrics.savingsTrend;
    updateTrendClass(elements.savingsTrend, state.metrics.totalSavings >= 0);
  }
}

function renderReportList() {
  if (!elements.list) {
    return;
  }

  if (!state.reports.length) {
    elements.list.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-folder-open"></i>
        <p>No reports yet. Generate one to see it listed here.</p>
      </div>
    `;
    return;
  }

  elements.list.innerHTML = state.reports
    .map((report) => {
      const icon = getIconForType(report.type);
      const dateLabel = formatFullDate(report.generatedAt);
      const summary = report.summary
        ? `<p class="report-summary">${escapeHtml(report.summary)}</p>`
        : "";
      return `
        <article class="report-card">
          <div class="card-left">
            <div class="icon-wrapper ${escapeHtml(report.type)}">
              <i class="fas ${icon}" aria-hidden="true"></i>
            </div>
            <div class="report-info">
              <h3>${escapeHtml(report.title)}</h3>
              <div class="report-details">
                <span class="detail-item">${escapeHtml(
                  report.periodLabel
                )}</span>
                <span class="detail-divider">•</span>
                <span class="detail-item">${escapeHtml(report.format)}</span>
                <span class="detail-divider">•</span>
                <span class="detail-item">${escapeHtml(dateLabel)}</span>
              </div>
              ${summary}
            </div>
          </div>
          <div class="report-actions">
            <span class="badge">${escapeHtml(report.format)}</span>
            <button type="button" class="download-btn" data-id="${report.id}">
              <i class="fas fa-download" aria-hidden="true"></i><span>Download</span>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function formatCurrency(value) {
  return currencyFormatter.format(roundCurrency(value));
}

function updateTrendClass(element, isPositive) {
  if (!element) {
    return;
  }
  element.classList.remove("positive", "negative", "neutral");
  if (!element.textContent?.trim()) {
    element.classList.add("neutral");
    return;
  }
  element.classList.add(isPositive ? "positive" : "negative");
}

function showStatus(message, variant = "info") {
  if (!elements.status) {
    return;
  }
  elements.status.textContent = message;
  elements.status.classList.remove("hidden", "info", "error", "success");
  elements.status.classList.add(variant);
}

function clearStatus() {
  if (!elements.status) {
    return;
  }
  elements.status.textContent = "";
  elements.status.classList.add("hidden");
  elements.status.classList.remove("info", "error", "success");
}

function disableButtons() {
  elements.generateBtn?.setAttribute("disabled", "disabled");
  elements.customBtn?.setAttribute("disabled", "disabled");
}

function formatPeriod(start, end, fallback) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (startDate && endDate) {
    const sameMonth =
      startDate.getFullYear() === endDate.getFullYear() &&
      startDate.getMonth() === endDate.getMonth();
    if (sameMonth) {
      return monthFormatter.format(startDate);
    }
    return `${monthFormatter.format(startDate)} – ${monthFormatter.format(
      endDate
    )}`;
  }
  const fallbackDate = parseDate(fallback) || new Date();
  return monthFormatter.format(fallbackDate);
}

function extractMonthKey(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) {
    return "";
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFullDate(value) {
  const date = parseDate(value);
  return date ? fullDateFormatter.format(date) : "--";
}

function computePercentChange(current, previous) {
  const currentValue = toNumber(current);
  const previousValue = toNumber(previous);
  if (previousValue === 0) {
    return currentValue > 0 ? 100 : 0;
  }
  return ((currentValue - previousValue) / previousValue) * 100;
}

function formatPercentChange(value) {
  const numeric = roundCurrency(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(1)}%`;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char];
  });
}

function formatDateForSql(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocale() {
  if (process.env.FINLYTICS_LOCALE) {
    return process.env.FINLYTICS_LOCALE;
  }
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en-IN";
}

function createCurrencyFormatter(localeValue) {
  try {
    return new Intl.NumberFormat(localeValue, {
      style: "currency",
      currency: process.env.FINLYTICS_CURRENCY || "INR",
      maximumFractionDigits: 0,
    });
  } catch (_error) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    });
  }
}

function createMonthFormatter(localeValue) {
  try {
    return new Intl.DateTimeFormat(localeValue, {
      month: "short",
      year: "numeric",
    });
  } catch (_error) {
    return new Intl.DateTimeFormat("en-IN", {
      month: "short",
      year: "numeric",
    });
  }
}

function createFullDateFormatter(localeValue) {
  try {
    return new Intl.DateTimeFormat(localeValue, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch (_error) {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
}

function getIconForType(type = "summary") {
  const map = {
    expense: "fa-chart-pie",
    income: "fa-sack-dollar",
    savings: "fa-piggy-bank",
    tax: "fa-file-invoice-dollar",
    summary: "fa-file-lines",
  };
  return map[type] || map.summary;
}
