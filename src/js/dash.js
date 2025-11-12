const database = require("../../electron/db");
const transactionsStore = require("../../electron/models/transactions");

const dependencyError = database.dependencyError;

const state = {
  profile: null,
  monthly: [],
  categories: [],
  totals: null,
  recent: [],
  subscriptions: {
    totalMonthly: 0,
    categories: new Map(),
  },
};

const charts = {
  expense: null,
  spending: null,
};

const elements = {};

let locale;
let currencyCode;
let currencyFormatter;
let percentFormatter;
let monthFormatter;
let dateFormatter;

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();

  locale = getLocale();
  currencyCode = process.env.FINLYTICS_CURRENCY || "INR";
  currencyFormatter = createCurrencyFormatter(locale, currencyCode);
  percentFormatter = createPercentFormatter(locale);
  monthFormatter = createMonthFormatter(locale);
  dateFormatter = createDateFormatter(locale);

  if (dependencyError) {
    showStatus(
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`,
      "error"
    );
    return;
  }

  await loadProfile();

  try {
    await loadDashboardData();
    renderStats();
    renderExpenseChart();
    renderSpendingChart();
    renderRecentTransactions();
    renderSuggestion();

    if (!hasAnyData()) {
      showStatus(
        "Add transactions or subscriptions to populate your dashboard insights.",
        "info"
      );
    } else {
      clearStatus();
    }
  } catch (error) {
    console.error("Finlytics dashboard: unable to load data", error);
    showStatus(
      `Unable to load dashboard data: ${database.normalizeDbError(error)}`,
      "error"
    );
  }
});

function cacheElements() {
  elements.greeting = document.getElementById("dash-greeting");
  elements.avatar = document.getElementById("dash-avatar");
  elements.status = document.getElementById("dashboard-status");
  elements.incomeValue = document.getElementById("stat-income-value");
  elements.incomeTrend = document.getElementById("stat-income-trend");
  elements.expenseValue = document.getElementById("stat-expense-value");
  elements.expenseTrend = document.getElementById("stat-expense-trend");
  elements.savingsValue = document.getElementById("stat-savings-value");
  elements.savingsTrend = document.getElementById("stat-savings-trend");
  elements.expenseCanvas = document.getElementById("expenseChart");
  elements.spendingCanvas = document.getElementById("spendingChart");
  elements.recentList = document.getElementById("recent-transactions-list");
  elements.savingSuggestion = document.getElementById("saving-suggestion");
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

async function loadProfile() {
  try {
    const profile = await database.getUserProfile();
    state.profile = profile;
    const fullName = profile?.full_name?.trim();
    if (fullName && elements.greeting) {
      elements.greeting.textContent = `Welcome back, ${fullName}`;
    } else if (elements.greeting) {
      elements.greeting.textContent = "Welcome back!";
    }
    if (fullName && elements.avatar) {
      elements.avatar.textContent = fullName.charAt(0).toUpperCase() || "F";
    }
  } catch (error) {
    console.warn("Finlytics dashboard: unable to load user profile", error);
  }
}

async function loadDashboardData() {
  await transactionsStore.ensureTransactionTable();
  await ensureSubscriptionsTable();

  const monthly = await queryMonthlySeries(6);
  const subscriptions = await querySubscriptionSummary();
  const categories = await queryExpenseCategories(90);
  const recent = await queryRecentTransactions(5);

  state.monthly = monthly;
  state.subscriptions = subscriptions;
  state.categories = mergeCategoryData(categories, subscriptions.categories);
  state.recent = recent;

  applySubscriptionsToMonthly();
  state.totals = computeTotals();
}

async function queryMonthlySeries(monthCount) {
  const now = new Date();
  const months = [];
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const point = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({
      key: formatMonthKey(point),
      label: monthFormatter.format(point),
      startDate: point,
      income: 0,
      expense: 0,
    });
  }

  if (!months.length) {
    return months;
  }

  const rangeStart = formatDateForSql(months[0].startDate);
  const rangeEnd = formatDateForSql(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );

  const result = await database.query(
    `
      SELECT
        strftime('%Y-%m', occurred_at) AS period,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
      FROM "transaction"
      WHERE occurred_at >= ? AND occurred_at < ?
      GROUP BY period
      ORDER BY period;
    `,
    [rangeStart, rangeEnd]
  );

  (result.rows || []).forEach((row) => {
    const bucket = months.find((item) => item.key === row.period);
    if (!bucket) {
      return;
    }
    bucket.income = toNumber(row.income);
    bucket.expense = toNumber(row.expense);
  });

  return months;
}

async function querySubscriptionSummary() {
  const summary = {
    totalMonthly: 0,
    categories: new Map(),
  };

  const result = await database.query(
    `
      SELECT category, amount, billing_cycle
      FROM subscriptions;
    `
  );

  (result.rows || []).forEach((row) => {
    const name = (row.category || "Subscriptions").trim() || "Subscriptions";
    const monthly = convertSubscriptionToMonthly(
      toNumber(row.amount),
      row.billing_cycle
    );
    summary.totalMonthly = roundCurrency(summary.totalMonthly + monthly);
    summary.categories.set(
      name,
      roundCurrency((summary.categories.get(name) || 0) + monthly)
    );
  });

  return summary;
}

async function queryExpenseCategories(lookbackDays) {
  const base = new Date();
  base.setDate(base.getDate() - Math.max(lookbackDays, 1));
  const start = formatDateForSql(base);

  const result = await database.query(
    `
      SELECT
        category,
        SUM(amount) AS total
      FROM "transaction"
      WHERE type = 'expense' AND occurred_at >= ?
      GROUP BY category
      ORDER BY total DESC;
    `,
    [start]
  );

  return (result.rows || []).map((row) => ({
    name: (row.category || "Uncategorized").trim() || "Uncategorized",
    amount: toNumber(row.total),
  }));
}

async function queryRecentTransactions(limit) {
  const transactions = await transactionsStore.listTransactions();
  return transactions.slice(0, limit);
}

function mergeCategoryData(transactionCategories, subscriptionCategories) {
  const map = new Map();

  transactionCategories.forEach((entry) => {
    const current = map.get(entry.name) || 0;
    map.set(entry.name, roundCurrency(current + entry.amount));
  });

  subscriptionCategories.forEach((value, name) => {
    const current = map.get(name) || 0;
    map.set(name, roundCurrency(current + value));
  });

  const categories = Array.from(map.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  if (categories.length <= 6) {
    return categories;
  }

  const top = categories.slice(0, 5);
  const remainder = categories.slice(5);
  const otherTotal = remainder.reduce((sum, item) => sum + item.amount, 0);
  top.push({ name: "Other", amount: roundCurrency(otherTotal) });
  return top;
}

function applySubscriptionsToMonthly() {
  if (!state.monthly.length || !state.subscriptions.totalMonthly) {
    return;
  }
  const monthlyAmount = state.subscriptions.totalMonthly;
  state.monthly.forEach((month) => {
    month.expense = roundCurrency(month.expense + monthlyAmount);
  });
}

function computeTotals() {
  const months = state.monthly;
  if (!months.length) {
    return {
      income: 0,
      expense: state.subscriptions.totalMonthly,
      savings: -state.subscriptions.totalMonthly,
      incomeTrend: 0,
      expenseTrend: 0,
      savingsTrend: 0,
    };
  }

  const current = months[months.length - 1];
  const previous = months.length > 1 ? months[months.length - 2] : null;

  const currentSavings = roundCurrency(current.income - current.expense);
  const previousSavings = previous
    ? roundCurrency(previous.income - previous.expense)
    : 0;

  return {
    income: roundCurrency(current.income),
    expense: roundCurrency(current.expense),
    savings: currentSavings,
    incomeTrend: computeTrend(current.income, previous?.income || 0),
    expenseTrend: computeTrend(current.expense, previous?.expense || 0),
    savingsTrend: computeTrend(currentSavings, previousSavings),
  };
}

function renderStats() {
  const totals = state.totals || {
    income: 0,
    expense: 0,
    savings: 0,
    incomeTrend: 0,
    expenseTrend: 0,
    savingsTrend: 0,
  };

  if (elements.incomeValue) {
    elements.incomeValue.textContent = formatCurrency(totals.income);
  }
  if (elements.expenseValue) {
    elements.expenseValue.textContent = formatCurrency(totals.expense);
  }
  if (elements.savingsValue) {
    elements.savingsValue.textContent = formatCurrency(totals.savings);
  }

  applyTrend(elements.incomeTrend, totals.incomeTrend);
  applyTrend(elements.expenseTrend, totals.expenseTrend, true);
  applyTrend(elements.savingsTrend, totals.savingsTrend);
}

function applyTrend(element, value, invert = false) {
  if (!element) {
    return;
  }

  element.classList.remove("positive", "negative", "neutral");

  if (!Number.isFinite(value) || Math.abs(value) < 0.05) {
    element.classList.add("neutral");
    element.innerHTML = '<i class="fas fa-minus" aria-hidden="true"></i> 0%';
    return;
  }

  const adjusted = invert ? value * -1 : value;
  const direction = adjusted >= 0 ? "positive" : "negative";
  const icon = adjusted >= 0 ? "fa-arrow-up" : "fa-arrow-down";
  element.classList.add(direction);
  element.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i> ${formatPercent(
    Math.abs(adjusted)
  )}`;
}

function renderExpenseChart() {
  if (!elements.expenseCanvas || typeof Chart === "undefined") {
    return;
  }

  const labels = state.categories.map((category) => category.name);
  const data = state.categories.map((category) =>
    roundCurrency(category.amount)
  );

  if (charts.expense) {
    charts.expense.destroy();
  }

  charts.expense = new Chart(elements.expenseCanvas, {
    type: "pie",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: [
            "#4c74ff",
            "#13c59f",
            "#9b5cff",
            "#f9a825",
            "#ff5c8a",
            "#6275ff",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: 0 },
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#dce2f1",
            boxWidth: 12,
            font: { size: 11 },
          },
        },
        tooltip: {
          callbacks: {
            label: (context) =>
              ` ${context.label}: ${formatCurrency(context.parsed)}`,
          },
        },
      },
    },
  });
}

function renderSpendingChart() {
  if (!elements.spendingCanvas || typeof Chart === "undefined") {
    return;
  }

  const labels = state.monthly.map((month) => month.label);
  const incomeSeries = state.monthly.map((month) =>
    roundCurrency(month.income)
  );
  const expenseSeries = state.monthly.map((month) =>
    roundCurrency(month.expense)
  );

  if (charts.spending) {
    charts.spending.destroy();
  }

  charts.spending = new Chart(elements.spendingCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Income",
          data: incomeSeries,
          borderColor: "#4c74ff",
          backgroundColor: "rgba(76, 116, 255, 0.18)",
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: "Expenses",
          data: expenseSeries,
          borderColor: "#1ec895",
          backgroundColor: "rgba(30, 200, 149, 0.2)",
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: 0 },
      scales: {
        x: {
          ticks: { color: "#7c86a1", font: { size: 11 } },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          ticks: {
            color: "#7c86a1",
            font: { size: 11 },
            callback: (value) => formatCurrency(value),
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#dce2f1", font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (context) =>
              ` ${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
    },
  });
}

function renderRecentTransactions() {
  if (!elements.recentList) {
    return;
  }

  if (!state.recent.length) {
    elements.recentList.innerHTML = `
      <li>
        <div>
          <h4>No transactions yet</h4>
          <span>Add a transaction to see it here.</span>
        </div>
      </li>
    `;
    return;
  }

  const rows = state.recent
    .map((transaction) => {
      const amountClass =
        transaction.type === "income" ? "positive" : "negative";
      const sign = transaction.type === "income" ? "+" : "-";
      return `
        <li>
          <div>
            <h4>${escapeHtml(transaction.title)}</h4>
            <span>${formatDate(transaction.occurredAt)}</span>
          </div>
          <span class="amount ${amountClass}">${sign}${formatCurrency(
        transaction.amount
      )}</span>
        </li>
      `;
    })
    .join("");

  elements.recentList.innerHTML = rows;
}

function renderSuggestion() {
  if (!elements.savingSuggestion) {
    return;
  }
  elements.savingSuggestion.textContent = computeSuggestion();
}

function computeSuggestion() {
  const baseIncome =
    Number(state.profile?.monthly_income) || state.totals?.income || 0;
  if (!baseIncome) {
    return "Add your income details to unlock tailored savings suggestions.";
  }
  const recommended = roundCurrency(baseIncome * 0.1);
  return `Automate ${formatCurrency(
    recommended
  )} into a high-yield savings plan this month.`;
}

function hasAnyData() {
  const hasMonthly = state.monthly.some(
    (month) => month.income > 0 || month.expense > 0
  );
  return hasMonthly || state.categories.length > 0 || state.recent.length > 0;
}

function formatCurrency(value) {
  if (!currencyFormatter) {
    return `₹${Number(value || 0).toFixed(0)}`;
  }
  return currencyFormatter.format(roundCurrency(value));
}

function formatPercent(value) {
  if (!percentFormatter) {
    return `${roundCurrency(value)}%`;
  }
  return percentFormatter.format((value || 0) / 100);
}

function formatDate(input) {
  if (!input) {
    return "--";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(String(input));
  }
  return dateFormatter.format(date);
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

function formatMonthKey(date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

function roundCurrency(value) {
  return Math.round((value || 0) * 100) / 100;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function computeTrend(current, previous) {
  const currentValue = toNumber(current);
  const previousValue = toNumber(previous);
  if (previousValue <= 0) {
    return currentValue > 0 ? 100 : 0;
  }
  return ((currentValue - previousValue) / previousValue) * 100;
}

function createCurrencyFormatter(localeValue, currency) {
  try {
    return new Intl.NumberFormat(localeValue, {
      style: "currency",
      currency,
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

function createPercentFormatter(localeValue) {
  try {
    return new Intl.NumberFormat(localeValue, {
      style: "percent",
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });
  } catch (_error) {
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
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

function createDateFormatter(localeValue) {
  try {
    return new Intl.DateTimeFormat(localeValue, {
      month: "short",
      day: "2-digit",
    });
  } catch (_error) {
    return new Intl.DateTimeFormat("en-IN", {
      month: "short",
      day: "2-digit",
    });
  }
}

function getLocale() {
  if (process.env.FINLYTICS_LOCALE) {
    return process.env.FINLYTICS_LOCALE;
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en-IN";
}

async function ensureSubscriptionsTable() {
  await database.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0),
      billing_cycle TEXT NOT NULL,
      next_billing_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function convertSubscriptionToMonthly(amount, billingCycle) {
  const normalized = String(billingCycle || "Monthly").trim();
  switch (normalized) {
    case "Weekly":
      return roundCurrency(amount * (52 / 12));
    case "Quarterly":
      return roundCurrency(amount / 3);
    case "Semiannual":
      return roundCurrency(amount / 6);
    case "Yearly":
    case "Annual":
      return roundCurrency(amount / 12);
    case "Monthly":
    default:
      return roundCurrency(amount);
  }
}
