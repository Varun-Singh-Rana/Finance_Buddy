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
      "error",
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

  // Open the custom report modal
  elements.customBtn?.addEventListener("click", openCustomModal);

  // Modal controls (may not exist immediately if DOM not ready elsewhere)
  const modal = document.getElementById("customReportModal");
  const modalClose = document.getElementById("customModalClose");
  const modalCancel = document.getElementById("customCancel");
  const modalForm = document.getElementById("customReportForm");

  modalClose?.addEventListener("click", closeCustomModal);
  modalCancel?.addEventListener("click", closeCustomModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeCustomModal();
  });
  modalForm?.addEventListener("submit", handleCreateCustomReport);

  // Handle download button clicks in the report list
  elements.list?.addEventListener("click", async (event) => {
    const button = event.target.closest(".download-btn");
    if (!button) {
      return;
    }
    const report = state.reports.find(
      (entry) => String(entry.id) === button.dataset.id,
    );
    if (!report) {
      showStatus("Selected report not found.", "error");
      return;
    }

    try {
      showStatus("Preparing PDF...", "info");
      button.disabled = true;
      const original = button.innerHTML;
      button.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>Preparing...</span>`;
      await generatePdf(report);
      showStatus(`Downloaded "${report.title}"`, "success");
      button.innerHTML = original;
    } catch (err) {
      console.error("PDF generation error", err);
      showStatus("Unable to generate PDF.", "error");
    } finally {
      button.disabled = false;
    }
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
        "info",
      );
    } else {
      clearStatus();
    }
  } catch (error) {
    console.error("Finlytics reports: unable to load data", error);
    showStatus(
      `Unable to load reports: ${database.normalizeDbError(error)}`,
      "error",
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
     LIMIT 30;`,
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
      row.generated_at,
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
       ORDER BY period;`,
    ),
    database.query(
      `SELECT SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
       FROM "transaction"
       WHERE strftime('%Y', occurred_at) = strftime('%Y', 'now');`,
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
    (report) => report.monthKey === currentMonthKey,
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
      new Date(now.getFullYear(), now.getMonth(), 1),
    );
    const periodEnd = formatDateForSql(
      new Date(now.getFullYear(), now.getMonth() + 1, 0),
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
      ],
    );

    showStatus(
      "Report saved. You can download it from the list below.",
      "success",
    );
    await refreshData();
  } catch (error) {
    console.error("Finlytics reports: generate failed", error);
    showStatus(
      `Unable to create report: ${database.normalizeDbError(error)}`,
      "error",
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

function renderMetrics() {
  if (elements.totalReports) {
    elements.totalReports.textContent = String(
      state.metrics.totalReports,
    ).padStart(2, "0");
  }
  if (elements.totalTrend) {
    elements.totalTrend.textContent = state.metrics.totalTrend;
    updateTrendClass(elements.totalTrend, state.metrics.totalReports > 0);
  }

  if (elements.avgSpending) {
    elements.avgSpending.textContent = formatCurrency(
      state.metrics.averageSpending,
    );
  }
  if (elements.avgTrend) {
    elements.avgTrend.textContent = state.metrics.averageTrend;
    updateTrendClass(
      elements.avgTrend,
      !state.metrics.averageTrend.includes("-"),
    );
  }

  if (elements.totalSavings) {
    elements.totalSavings.textContent = formatCurrency(
      state.metrics.totalSavings,
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
                  report.periodLabel,
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
      endDate,
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

function escapeFileName(name) {
  return (
    String(name || "report")
      .replace(/[\\/:*?"<>|]/g, "")
      .trim() || "report"
  );
}

async function generatePdf(report) {
  // Prefer native Electron PDF generation (main process) for reliability.
  try {
    const { ipcRenderer, shell } = require("electron");

    // determine period for transactions
    let periodStart = report.periodStart || null;
    let periodEnd = report.periodEnd || null;
    if (!periodStart || !periodEnd) {
      const genDate = parseDate(report.generatedAt) || new Date();
      periodStart = formatDateForSql(
        new Date(genDate.getFullYear(), genDate.getMonth(), 1),
      );
      periodEnd = formatDateForSql(
        new Date(genDate.getFullYear(), genDate.getMonth() + 1, 0),
      );
    }

    // fetch transactions in period
    let transactions = [];
    try {
      const txRes = await database.query(
        `SELECT id, title, category, type, amount, occurred_at, notes
         FROM "transaction"
         WHERE date(occurred_at) >= date(?) AND date(occurred_at) <= date(?)
         ORDER BY date(occurred_at) ASC, id ASC;`,
        [periodStart, periodEnd],
      );
      transactions = (txRes.rows || []).map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        type: r.type,
        amount: Number(r.amount) || 0,
        occurred_at: r.occurred_at,
        notes: r.notes || "",
      }));
    } catch (_err) {
      transactions = [];
    }

    // ensure subscriptions table exists and fetch subscriptions
    try {
      await database.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          amount REAL NOT NULL CHECK (amount >= 0),
          billing_cycle TEXT NOT NULL,
          next_billing_date TEXT NOT NULL,
          is_paused INTEGER DEFAULT 0,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (_e) {}

    let subscriptions = [];
    try {
      const subRes = await database.query(
        `SELECT id, name, category, amount, billing_cycle, next_billing_date, notes
         FROM subscriptions
         WHERE IFNULL(is_paused, 0) = 0
         ORDER BY name;`,
      );
      subscriptions = (subRes.rows || []).map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        amount: Number(r.amount) || 0,
        billing_cycle: r.billing_cycle,
        next_billing_date: r.next_billing_date,
        notes: r.notes || "",
      }));
    } catch (_err) {
      subscriptions = [];
    }

    // utility to convert billing cycles to monthly equivalent
    function convertSubscriptionToMonthly(amount, billingCycle) {
      const cycle = (billingCycle || "Monthly").toLowerCase();
      switch (cycle) {
        case "weekly":
          return Number(amount) * (52 / 12);
        case "quarterly":
          return Number(amount) / 3;
        case "semiannual":
        case "semi-annual":
          return Number(amount) / 6;
        case "yearly":
        case "annual":
          return Number(amount) / 12;
        case "monthly":
        default:
          return Number(amount) || 0;
      }
    }

    // compute totals
    const totals = { income: 0, expense: 0 };
    transactions.forEach((t) => {
      if (t.type === "income") totals.income += t.amount;
      else if (t.type === "expense") totals.expense += t.amount;
    });

    // build transactions table rows
    const txRowsHtml = transactions
      .map(
        (t) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(formatFullDate(t.occurred_at))}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(t.title)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(t.category)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(t.type)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatCurrency(t.amount))}</td>
        </tr>
      `,
      )
      .join("");

    // build subscriptions table rows
    const subRowsHtml = subscriptions
      .map((s) => {
        const monthly = convertSubscriptionToMonthly(s.amount, s.billing_cycle);
        return `
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(s.name)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(s.category)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(String(s.billing_cycle))}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(formatFullDate(s.next_billing_date))}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatCurrency(s.amount))}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatCurrency(monthly))}</td>
          </tr>
        `;
      })
      .join("");

    // build final HTML with tables and summary
    const content = `
      <div style="padding:20px;">
        <h1 style="margin:0 0 6px;font-size:26px;color:#04131c;">${escapeHtml(report.title)}</h1>
        <div style="color:#6b7280;margin-bottom:14px;font-size:12px">${escapeHtml(
          report.periodLabel,
        )} • ${escapeHtml(report.format)} • ${escapeHtml(formatFullDate(report.generatedAt))}</div>
        ${report.summary ? `<p style="color:#333;margin-top:8px;">${escapeHtml(report.summary)}</p>` : ""}

        <section style="margin-top:14px">
          <h2 style="font-size:18px;margin:0 0 8px">Snapshot</h2>
          <div style="display:flex;gap:24px;margin-top:8px;flex-wrap:wrap;">
            <div style="min-width:160px;">
              <div style="font-size:12px;color:#6b7280">Total Reports</div>
              <div style="font-weight:700;font-size:16px">${String(state.metrics.totalReports).padStart(2, "0")}</div>
            </div>
            <div style="min-width:160px;">
              <div style="font-size:12px;color:#6b7280">Average Monthly Spending</div>
              <div style="font-weight:700;font-size:16px">${formatCurrency(state.metrics.averageSpending)}</div>
            </div>
            <div style="min-width:160px;">
              <div style="font-size:12px;color:#6b7280">Total Savings</div>
              <div style="font-weight:700;font-size:16px">${formatCurrency(state.metrics.totalSavings)}</div>
            </div>
          </div>
        </section>

        <section style="margin-top:22px">
          <h2 style="font-size:18px;margin:0 0 8px">Transactions (${escapeHtml(periodStart)} – ${escapeHtml(periodEnd)})</h2>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Date</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Title</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Category</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Type</th>
                <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #ddd">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${txRowsHtml || `<tr><td colspan="5" style="padding:12px;color:#6b7280">No transactions in this period.</td></tr>`}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4" style="padding:10px 12px;border-top:2px solid #ddd;font-weight:700">Totals</td>
                <td style="padding:10px 12px;border-top:2px solid #ddd;text-align:right;font-weight:700">${formatCurrency(totals.income - totals.expense)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section style="margin-top:22px">
          <h2 style="font-size:18px;margin:0 0 8px">Subscriptions</h2>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Name</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Category</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Cycle</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd">Next Billing</th>
                <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #ddd">Amount</th>
                <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #ddd">Monthly</th>
              </tr>
            </thead>
            <tbody>
              ${subRowsHtml || `<tr><td colspan="6" style="padding:12px;color:#6b7280">No subscriptions found.</td></tr>`}
            </tbody>
          </table>
        </section>

      </div>
    `;

    const fullHtml = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; color: #04131c; margin: 0; padding: 0; background: #ffffff; }
          h1,h2 { color: #04131c; }
          table { font-family: inherit; }
        </style>
      </head>
      <body>
        ${content}
      </body>
      </html>
    `;

    const filename = `${escapeFileName(report.title)}.pdf`;
    const result = await ipcRenderer.invoke("reports:generate-pdf", {
      html: fullHtml,
      filename,
    });
    if (result?.filePath) {
      try {
        await shell.openPath(result.filePath);
      } catch (_e) {}
    }
    return;
  } catch (error) {
    console.warn(
      "Native PDF generation failed, falling back to html2pdf:",
      error,
    );
    // fallback to client-side html2pdf (previous approach)
  }

  // --- fallback (client-side html2pdf) ---
  return new Promise((resolve, reject) => {
    try {
      const container = document.createElement("div");
      container.style.fontFamily = "Poppins, sans-serif";
      container.style.padding = "18px";
      container.style.background = "#ffffff";
      container.style.color = "#04131c";
      container.style.width = "780px";
      container.style.boxSizing = "border-box";

      const html = `
        <div style="padding:20px;">${report && report.title ? escapeHtml(report.title) : "Report"}</div>
      `;

      container.innerHTML = html;
      // keep in viewport but hidden from pointer events
      container.style.position = "fixed";
      container.style.top = "0";
      container.style.left = "0";
      container.style.zIndex = "999999";
      container.style.pointerEvents = "none";
      document.body.appendChild(container);

      const filename = `${escapeFileName(report.title)}.pdf`;
      const opt = {
        margin: [20, 20, 20, 20],
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
      };

      const proceed = () => {
        try {
          html2pdf()
            .set(opt)
            .from(container)
            .save()
            .then(() => {
              container.remove();
              resolve();
            })
            .catch((err) => {
              container.remove();
              reject(err);
            });
        } catch (err) {
          container.remove();
          reject(err);
        }
      };

      if (document.fonts && typeof document.fonts.ready?.then === "function") {
        document.fonts.ready.then(() => setTimeout(proceed, 80));
      } else {
        setTimeout(proceed, 120);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function openCustomModal() {
  const modal = document.getElementById("customReportModal");
  if (!modal) return;
  // populate sensible defaults
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const titleInput = document.getElementById("customTitle");
  const startInput = document.getElementById("customStart");
  const endInput = document.getElementById("customEnd");
  if (titleInput)
    titleInput.value = `Custom Report - ${monthFormatter.format(now)}`;
  if (startInput) startInput.value = formatDateForSql(start);
  if (endInput) endInput.value = formatDateForSql(end);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeCustomModal() {
  const modal = document.getElementById("customReportModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function handleCreateCustomReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form) return;
  const title = (document.getElementById("customTitle")?.value || "").trim();
  const periodStart = document.getElementById("customStart")?.value || null;
  const periodEnd = document.getElementById("customEnd")?.value || null;
  const type = document.getElementById("customType")?.value || "summary";
  const format = document.getElementById("customFormat")?.value || "PDF";
  if (!title || !periodStart || !periodEnd) {
    showStatus("Please complete the form before creating the report.", "error");
    return;
  }

  const button = document.getElementById("customCreateBtn");
  try {
    button?.setAttribute("disabled", "disabled");
    await ensureReportTable();
    const summary = `Custom ${type} report from ${periodStart} to ${periodEnd}`;
    const result = await database.query(
      `INSERT INTO report_history (title, report_type, file_format, period_start, period_end, summary)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [title, type, format, periodStart, periodEnd, summary],
    );
    const insertedId = result.lastID;
    // fetch the inserted row
    const sel = await database.query(
      `SELECT id, title, report_type, file_format, period_start, period_end, summary, generated_at
       FROM report_history WHERE id = ? LIMIT 1;`,
      [insertedId],
    );
    const row = sel.rows?.[0];
    if (row) {
      const newReport = {
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
          row.generated_at,
        ),
        monthKey: extractMonthKey(row.generated_at),
      };
      showStatus("Custom report saved.", "success");
      closeCustomModal();
      await refreshData();
      // offer download immediately
      try {
        await generatePdf(newReport);
        showStatus(`Downloaded "${newReport.title}"`, "success");
      } catch (err) {
        console.warn("Generate PDF for custom report failed", err);
      }
    } else {
      showStatus("Failed to retrieve created report.", "error");
    }
  } catch (error) {
    console.error("Failed to create custom report", error);
    showStatus(
      `Unable to create report: ${database.normalizeDbError(error)}`,
      "error",
    );
  } finally {
    button?.removeAttribute("disabled");
  }
}
