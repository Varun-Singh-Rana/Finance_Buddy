const database = require("../../electron/db");
const transactionsStore = require("../../electron/models/transactions");

const dependencyError = database.dependencyError;

document.addEventListener("DOMContentLoaded", async () => {
  const state = {
    history: [],
    forecast: [],
    labels: [],
    incomeSeries: [],
    actualExpenseSeries: [],
    forecastExpenseSeries: [],
    categoryRows: [],
    trendSummary: null,
    incomeSummary: null,
    riskCategory: null,
  };

  const charts = {
    incomeExpense: null,
    categoryForecast: null,
  };

  const elements = cacheElements();

  const locale = process.env.FINLYTICS_LOCALE || "en-IN";
  const currencyCode = process.env.FINLYTICS_CURRENCY || "INR";

  const currencyFormatter = createCurrencyFormatter(locale, currencyCode);
  const percentFormatter = createPercentFormatter(locale);
  const monthFormatter = createMonthFormatter(locale);

  if (dependencyError) {
    showStatus(
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` inside the project folder and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`,
      "error"
    );
    return;
  }

  await loadProfile();
  await loadForecastData();
  updateInsights();
  buildIncomeExpenseChart();
  buildCategoryForecastChart();
  populateCategoryTable();

  function cacheElements() {
    return {
      incomeExpenseCanvas: document.getElementById("incomeExpenseChart"),
      categoryForecastCanvas: document.getElementById("categoryForecastChart"),
      categoryTableBody: document.getElementById("categoryTableBody"),
      status: document.getElementById("forecast-status"),
      greeting: document.getElementById("forecast-greeting"),
      avatar: document.getElementById("forecast-avatar"),
      insightPositiveTitle: document.getElementById("insight-positive-title"),
      insightPositiveText: document.getElementById("insight-positive-text"),
      insightIncomeTitle: document.getElementById("insight-income-title"),
      insightIncomeText: document.getElementById("insight-income-text"),
      insightRiskTitle: document.getElementById("insight-risk-title"),
      insightRiskText: document.getElementById("insight-risk-text"),
    };
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
    if (!elements.greeting && !elements.avatar) {
      return;
    }
    try {
      const profile = await database.getUserProfile();
      const fullName = profile?.full_name?.trim();
      if (fullName && elements.greeting) {
        elements.greeting.textContent = `Welcome back, ${fullName}`;
      }
      if (fullName && elements.avatar) {
        elements.avatar.textContent = fullName.charAt(0).toUpperCase() || "F";
      }
    } catch (error) {
      console.warn("Finlytics forecast: unable to load user profile", error);
    }
  }

  async function loadForecastData() {
    try {
      await transactionsStore.ensureTransactionTable();
      await ensureSubscriptionsTable();

      const history = await queryMonthlyHistory(6);
      state.history = history;

      const hasRecordedActivity = history.some(
        (item) => item.income > 0 || item.expense > 0
      );

      if (!hasRecordedActivity) {
        showStatus(
          "Add transactions and subscriptions to unlock personalized forecasts.",
          "info"
        );
        return;
      }

      clearStatus();

      const forecast = computeForecastFromHistory(history, 3);
      state.forecast = forecast;

      composeSeries(history, forecast);

      state.categoryRows = await computeCategoryOutlook(history);
      state.trendSummary = computeExpenseTrend(history, forecast);
      state.incomeSummary = computeIncomeTrend(history, forecast);
      state.riskCategory =
        state.categoryRows
          .filter((row) => row.change > 0)
          .sort((a, b) => b.changePct - a.changePct)[0] || null;
    } catch (error) {
      console.error("Finlytics forecast: unable to load data", error);
      showStatus(
        `Unable to load forecast data: ${database.normalizeDbError(error)}`,
        "error"
      );
    }
  }

  async function queryMonthlyHistory(monthCount) {
    const now = new Date();
    const months = [];
    for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push({
        key: formatMonthKey(date),
        label: monthFormatter.format(date),
        startDate: date,
        income: 0,
        expense: 0,
      });
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

  function computeForecastFromHistory(history, monthsAhead) {
    if (!history.length) {
      return [];
    }

    const expenseValues = history.map((item) => item.expense);
    const incomeValues = history.map((item) => item.income);
    const expenseDelta = averageChange(expenseValues);
    const incomeDelta = averageChange(incomeValues);

    const forecast = [];
    let previousExpense = expenseValues[expenseValues.length - 1] || 0;
    let previousIncome = incomeValues[incomeValues.length - 1] || 0;
    const anchorDate = history[history.length - 1].startDate;

    for (let step = 1; step <= monthsAhead; step += 1) {
      const pointDate = new Date(
        anchorDate.getFullYear(),
        anchorDate.getMonth() + step,
        1
      );
      previousExpense = Math.max(
        0,
        roundCurrency(previousExpense + expenseDelta)
      );
      previousIncome = Math.max(0, roundCurrency(previousIncome + incomeDelta));
      forecast.push({
        key: formatMonthKey(pointDate),
        label: monthFormatter.format(pointDate),
        startDate: pointDate,
        expense: previousExpense,
        income: previousIncome,
      });
    }

    return forecast;
  }

  async function computeCategoryOutlook(history) {
    if (!history.length) {
      return [];
    }

    const currentPeriod = history[history.length - 1];
    const previousPeriod =
      history.length > 1 ? history[history.length - 2] : null;
    const periodStart = formatDateForSql(
      new Date(
        currentPeriod.startDate.getFullYear(),
        currentPeriod.startDate.getMonth() - 1,
        1
      )
    );
    const periodEnd = formatDateForSql(
      new Date(
        currentPeriod.startDate.getFullYear(),
        currentPeriod.startDate.getMonth() + 1,
        1
      )
    );

    const categoryResult = await database.query(
      `
        SELECT
          category,
          strftime('%Y-%m', occurred_at) AS period,
          SUM(amount) AS total
        FROM "transaction"
        WHERE type = 'expense'
          AND occurred_at >= ?
          AND occurred_at < ?
        GROUP BY category, period;
      `,
      [periodStart, periodEnd]
    );

    const categoryMap = new Map();

    (categoryResult.rows || []).forEach((row) => {
      const name = (row.category || "Uncategorized").trim() || "Uncategorized";
      const totals = categoryMap.get(name) || { current: 0, previous: 0 };
      const periodKey = row.period;
      if (periodKey === currentPeriod.key) {
        totals.current += toNumber(row.total);
      } else if (previousPeriod && periodKey === previousPeriod.key) {
        totals.previous += toNumber(row.total);
      }
      categoryMap.set(name, totals);
    });

    const subscriptionResult = await database.query(
      `
        SELECT category, amount, billing_cycle
        FROM subscriptions;
      `
    );

    (subscriptionResult.rows || []).forEach((row) => {
      const name = (row.category || "Subscriptions").trim() || "Subscriptions";
      const totals = categoryMap.get(name) || { current: 0, previous: 0 };
      const monthly = convertSubscriptionToMonthly(
        toNumber(row.amount),
        row.billing_cycle
      );
      totals.current += monthly;
      totals.previous += monthly;
      categoryMap.set(name, totals);
    });

    const rows = Array.from(categoryMap.entries()).map(([name, totals]) => {
      const current = roundCurrency(totals.current);
      const previous = roundCurrency(totals.previous);
      const baseline = previous > 0 ? previous : current;
      const trend = previous > 0 ? current - previous : baseline * 0.05;
      const forecast = Math.max(0, roundCurrency(current + trend));
      const change = forecast - current;
      const changePct =
        current > 0 ? (change / current) * 100 : forecast > 0 ? 100 : 0;
      return {
        name,
        current,
        forecast,
        change,
        changePct,
      };
    });

    rows.sort((a, b) => b.current - a.current);
    return rows.slice(0, 6);
  }

  function composeSeries(history, forecast) {
    state.labels = [];
    state.incomeSeries = [];
    state.actualExpenseSeries = [];
    state.forecastExpenseSeries = [];

    history.forEach((month, index) => {
      state.labels.push(month.label);
      state.incomeSeries.push(roundCurrency(month.income));
      state.actualExpenseSeries.push(roundCurrency(month.expense));
      state.forecastExpenseSeries.push(
        index === history.length - 1 ? roundCurrency(month.expense) : null
      );
    });

    forecast.forEach((month) => {
      state.labels.push(month.label);
      state.incomeSeries.push(roundCurrency(month.income));
      state.actualExpenseSeries.push(null);
      state.forecastExpenseSeries.push(roundCurrency(month.expense));
    });
  }

  function computeExpenseTrend(history, forecast) {
    if (!history.length) {
      return null;
    }
    const expenses = history.map((item) => item.expense);
    const first = expenses[0];
    const lastActual = expenses[expenses.length - 1];
    const projectedFinal = forecast.length
      ? forecast[forecast.length - 1].expense
      : lastActual;
    const actualChangePct =
      first > 0 ? ((lastActual - first) / first) * 100 : 0;
    const projectedChangePct =
      lastActual > 0
        ? ((projectedFinal - lastActual) / lastActual) * 100
        : projectedFinal > 0
        ? 100
        : 0;
    return {
      actualChangePct,
      projectedChangePct,
      lastActual,
      projectedFinal,
    };
  }

  function computeIncomeTrend(history, forecast) {
    if (!history.length) {
      return null;
    }
    const incomes = history.map((item) => item.income);
    const first = incomes[0];
    const lastActual = incomes[incomes.length - 1];
    const projectedFinal = forecast.length
      ? forecast[forecast.length - 1].income
      : lastActual;
    const actualChangePct =
      first > 0 ? ((lastActual - first) / first) * 100 : 0;
    const projectedChangePct =
      lastActual > 0
        ? ((projectedFinal - lastActual) / lastActual) * 100
        : projectedFinal > 0
        ? 100
        : 0;
    return {
      actualChangePct,
      projectedChangePct,
      lastActual,
      projectedFinal,
    };
  }

  function buildIncomeExpenseChart() {
    if (!elements.incomeExpenseCanvas || typeof Chart === "undefined") {
      return;
    }

    if (!state.labels.length) {
      return;
    }

    if (charts.incomeExpense) {
      charts.incomeExpense.destroy();
    }

    charts.incomeExpense = new Chart(elements.incomeExpenseCanvas, {
      type: "line",
      data: {
        labels: state.labels,
        datasets: [
          {
            label: "Actual Expenses",
            data: state.actualExpenseSeries,
            borderColor: "#5c6bf5",
            backgroundColor: "rgba(92, 107, 245, 0.25)",
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: "#5c6bf5",
            spanGaps: false,
          },
          {
            label: "Forecasted Expenses",
            data: state.forecastExpenseSeries,
            borderColor: "#bc57ff",
            backgroundColor: "rgba(188, 87, 255, 0.25)",
            borderDash: [6, 4],
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: "#bc57ff",
            spanGaps: true,
          },
          {
            label: "Income",
            data: state.incomeSeries,
            borderColor: "#1ec895",
            backgroundColor: "rgba(30, 200, 149, 0.25)",
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: "#1ec895",
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#dce2f1",
              usePointStyle: true,
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || "";
                const value = context.parsed.y;
                if (value == null) {
                  return null;
                }
                return `${label}: ${currencyFormatter.format(value)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#7c86a1",
            },
            grid: {
              color: "rgba(255, 255, 255, 0.03)",
            },
          },
          y: {
            ticks: {
              color: "#7c86a1",
              callback: (value) => currencyFormatter.format(value),
            },
            grid: {
              color: "rgba(255, 255, 255, 0.03)",
            },
          },
        },
      },
    });
  }

  function buildCategoryForecastChart() {
    if (!elements.categoryForecastCanvas || typeof Chart === "undefined") {
      return;
    }

    if (!state.categoryRows.length) {
      return;
    }

    if (charts.categoryForecast) {
      charts.categoryForecast.destroy();
    }

    const labels = state.categoryRows.map((row) => row.name);
    const currentValues = state.categoryRows.map((row) => row.current);
    const forecastValues = state.categoryRows.map((row) => row.forecast);

    charts.categoryForecast = new Chart(elements.categoryForecastCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Current Month",
            data: currentValues,
            backgroundColor: "rgba(92, 123, 255, 0.85)",
            borderRadius: 10,
          },
          {
            label: "Next Month Forecast",
            data: forecastValues,
            backgroundColor: "rgba(30, 200, 149, 0.85)",
            borderRadius: 10,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#dce2f1",
              usePointStyle: true,
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || "";
                const value = context.parsed.y;
                return `${label}: ${currencyFormatter.format(value)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#7c86a1",
            },
            grid: {
              display: false,
            },
          },
          y: {
            ticks: {
              color: "#7c86a1",
              callback: (value) => currencyFormatter.format(value),
            },
            grid: {
              color: "rgba(255, 255, 255, 0.03)",
            },
          },
        },
      },
    });
  }

  function populateCategoryTable() {
    if (!elements.categoryTableBody) {
      return;
    }

    elements.categoryTableBody.innerHTML = "";

    if (!state.categoryRows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "No expense categories available yet.";
      row.appendChild(cell);
      elements.categoryTableBody.appendChild(row);
      return;
    }

    state.categoryRows.forEach((item) => {
      const changePositive = item.change <= 0;
      const row = document.createElement("tr");

      const nameCell = document.createElement("td");
      nameCell.textContent = item.name;

      const rangeCell = document.createElement("td");
      rangeCell.innerHTML = `${currencyFormatter.format(
        item.current
      )} → ${currencyFormatter.format(
        item.forecast
      )} <span class="range-text">${percentFormatter.format(
        item.changePct / 100
      )}</span>`;

      const pillCell = document.createElement("td");
      const pill = document.createElement("span");
      pill.classList.add(
        "trend-pill",
        changePositive ? "positive" : "negative"
      );
      pill.innerHTML = `
        <i class="fas ${changePositive ? "fa-arrow-down" : "fa-arrow-up"}"></i>
        ${percentFormatter.format(Math.abs(item.changePct) / 100)}
      `;
      pillCell.appendChild(pill);

      const deltaCell = document.createElement("td");
      deltaCell.classList.add(
        "delta",
        changePositive ? "positive" : "negative"
      );
      deltaCell.textContent =
        item.change === 0
          ? currencyFormatter.format(0)
          : `${item.change > 0 ? "+" : "-"}${currencyFormatter.format(
              Math.abs(item.change)
            )}`;

      row.appendChild(nameCell);
      row.appendChild(rangeCell);
      row.appendChild(pillCell);
      row.appendChild(deltaCell);
      elements.categoryTableBody.appendChild(row);
    });
  }

  function updateInsights() {
    if (!elements.insightPositiveText || !state.history.length) {
      return;
    }

    if (!state.history.some((item) => item.income > 0 || item.expense > 0)) {
      elements.insightPositiveTitle.textContent = "Positive Trend";
      elements.insightPositiveText.textContent =
        "Track your expenses and income to unlock smart commentary.";
      elements.insightIncomeTitle.textContent = "Income Outlook";
      elements.insightIncomeText.textContent =
        "We will project your income once transactions are recorded.";
      elements.insightRiskTitle.textContent = "Watch Out";
      elements.insightRiskText.textContent =
        "Add spending categories so we can highlight potential risks.";
      return;
    }

    if (state.trendSummary) {
      const actualDirection =
        state.trendSummary.actualChangePct <= 0 ? "decrease" : "increase";
      const projectedDirection =
        state.trendSummary.projectedChangePct <= 0 ? "decrease" : "increase";
      const actualPercent = percentFormatter.format(
        Math.abs(state.trendSummary.actualChangePct) / 100
      );
      const projectedPercent = percentFormatter.format(
        Math.abs(state.trendSummary.projectedChangePct) / 100
      );
      elements.insightPositiveTitle.textContent = "Spending Trajectory";
      elements.insightPositiveText.textContent =
        state.trendSummary.actualChangePct === 0
          ? "Your expenses are holding steady month over month."
          : `Expenses show a ${actualDirection} of ${actualPercent} across the recent period, with a projected ${projectedDirection} of ${projectedPercent}.`;
    }

    if (state.incomeSummary) {
      const projectedDirection =
        state.incomeSummary.projectedChangePct >= 0 ? "increase" : "dip";
      const projectedPercent = percentFormatter.format(
        Math.abs(state.incomeSummary.projectedChangePct) / 100
      );
      elements.insightIncomeTitle.textContent = "Income Outlook";
      elements.insightIncomeText.textContent =
        state.incomeSummary.projectedChangePct === 0
          ? "Income is projected to stay consistent based on recent trends."
          : `Income is projected to ${projectedDirection} by ${projectedPercent} over the next quarter.`;
    }

    if (state.riskCategory) {
      const changePercent = percentFormatter.format(
        Math.abs(state.riskCategory.changePct) / 100
      );
      elements.insightRiskTitle.textContent = "Spending Hotspot";
      elements.insightRiskText.textContent =
        state.riskCategory.changePct > 0
          ? `${state.riskCategory.name} is forecast to rise by ${changePercent}. Consider tightening this category.`
          : `${state.riskCategory.name} is trending down by ${changePercent}, freeing up room in your budget.`;
    } else {
      elements.insightRiskTitle.textContent = "Watch Out";
      elements.insightRiskText.textContent =
        "No high-risk categories detected. Keep monitoring your spending mix.";
    }
  }

  function createCurrencyFormatter(localeValue, currencyValue) {
    try {
      return new Intl.NumberFormat(localeValue, {
        style: "currency",
        currency: currencyValue,
        maximumFractionDigits: 0,
      });
    } catch (error) {
      console.warn(
        "Finlytics forecast: falling back to INR format",
        error.message
      );
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
      });
    } catch (_error) {
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
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
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
      });
    }
  }

  function formatMonthKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  function formatDateForSql(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function averageChange(values) {
    if (!values || values.length < 2) {
      return 0;
    }
    let total = 0;
    for (let index = 1; index < values.length; index += 1) {
      total += values[index] - values[index - 1];
    }
    return total / (values.length - 1);
  }

  function roundCurrency(value) {
    return Math.round((value || 0) * 100) / 100;
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
});
