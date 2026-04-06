const database = require("../../electron/db");
const transactionsStore = require("../../electron/models/transactions");

const dependencyError = database.dependencyError;

document.addEventListener("DOMContentLoaded", async () => {
  const state = {
    history: [],
    forecast: [],
    boostedForecast: [],
    labels: [],
    incomeSeries: [],
    actualExpenseSeries: [],
    forecastExpenseSeries: [],
    categoryRows: [],
    trendSummary: null,
    incomeSummary: null,
    riskCategory: null,
    nextMonthSnapshot: null,
    aiContributions: {
      income: [],
      expense: [],
      savings: [],
      categories: {},
    },
    aiInsight: "",
  };

  const featureLabels = {
    timeIndex: "Recent month trend",
    prevIncome: "Last month income",
    prevExpense: "Last month expenses",
    incomeMomentum: "Income momentum",
    expenseMomentum: "Expense momentum",
    incomeAvg3: "Income 3-mo avg",
    expenseAvg3: "Expense 3-mo avg",
    incomeVolatility: "Income volatility",
    expenseVolatility: "Expense volatility",
    savingsPrev: "Last month savings",
    expenseToIncomeRatioPrev: "Expense-to-income ratio",
    seasonSin: "Seasonal swing",
    seasonCos: "Seasonal alignment",
    prevValue: "Last month spend",
    momentum: "Category momentum",
    avg3: "Category 3-mo avg",
    volatility: "Category volatility",
    bias: "Model baseline",
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
      "error",
    );
    return;
  }

  await loadProfile();
  await loadForecastData();
  updateInsights();
  buildIncomeExpenseChart();
  buildCategoryForecastChart();
  populateCategoryTable();
  updateAiExplainability();

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
      aiIncomePred: document.getElementById("ai-income-pred"),
      aiExpensePred: document.getElementById("ai-expense-pred"),
      aiSavingsPred: document.getElementById("ai-savings-pred"),
      aiIncomeDriver: document.getElementById("ai-income-driver"),
      aiExpenseDriver: document.getElementById("ai-expense-driver"),
      aiSavingsDriver: document.getElementById("ai-savings-driver"),
      aiModelPill: document.getElementById("ai-model-pill"),
      aiDriverList: document.getElementById("ai-driver-list"),
      aiInsightText: document.getElementById("ai-insight-text"),
      aiCategoryList: document.getElementById("ai-category-list"),
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
        (item) => item.income > 0 || item.expense > 0,
      );

      if (!hasRecordedActivity) {
        showStatus(
          "Add transactions and subscriptions to unlock personalized forecasts.",
          "info",
        );
        return;
      }

      clearStatus();

      const boosted = await computeBoostedForecast(history, 3);
      state.boostedForecast = boosted?.points || [];
      state.forecast =
        boosted?.points && boosted.points.length
          ? boosted.points
          : computeForecastFromHistory(history, 3);
      state.nextMonthSnapshot = boosted?.nextMonthSnapshot || null;
      state.aiContributions = boosted?.contributions || state.aiContributions;
      state.aiInsight = boosted?.insight || "";

      composeSeries(history, state.forecast);

      state.categoryRows = await computeCategoryOutlook(history);
      state.trendSummary = computeExpenseTrend(history, state.forecast);
      state.incomeSummary = computeIncomeTrend(history, state.forecast);
      state.riskCategory =
        state.categoryRows
          .filter((row) => row.change > 0)
          .sort((a, b) => b.changePct - a.changePct)[0] || null;
    } catch (error) {
      console.error("Finlytics forecast: unable to load data", error);
      showStatus(
        `Unable to load forecast data: ${database.normalizeDbError(error)}`,
        "error",
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
      new Date(now.getFullYear(), now.getMonth() + 1, 1),
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
      [rangeStart, rangeEnd],
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
        1,
      );
      previousExpense = Math.max(
        0,
        roundCurrency(previousExpense + expenseDelta),
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

  async function computeBoostedForecast(history, monthsAhead) {
    if (!history || history.length < 3) {
      return null;
    }

    const featureKeys = [
      "timeIndex",
      "prevIncome",
      "prevExpense",
      "incomeMomentum",
      "expenseMomentum",
      "incomeAvg3",
      "expenseAvg3",
      "incomeVolatility",
      "expenseVolatility",
      "savingsPrev",
      "expenseToIncomeRatioPrev",
      "seasonSin",
      "seasonCos",
    ];

    const incomeTraining = [];
    const expenseTraining = [];

    for (let index = 1; index < history.length; index += 1) {
      const featureVector = buildFeatureVector(history, index);
      if (!featureVector) {
        continue;
      }
      incomeTraining.push({
        features: featureVector,
        target: roundCurrency(history[index].income),
      });
      expenseTraining.push({
        features: featureVector,
        target: roundCurrency(history[index].expense),
      });
    }

    if (incomeTraining.length < 2 || expenseTraining.length < 2) {
      return null;
    }

    const incomeModel = trainGradientBoosting(incomeTraining, featureKeys, {
      trees: 10,
      learningRate: 0.3,
    });
    const expenseModel = trainGradientBoosting(expenseTraining, featureKeys, {
      trees: 10,
      learningRate: 0.3,
    });

    if (!incomeModel || !expenseModel) {
      return null;
    }

    const syntheticHistory = [...history];
    const forecast = [];
    let nextMonthSnapshot = null;
    let contributions = {
      income: [],
      expense: [],
      savings: [],
      categories: {},
    };

    for (let step = 1; step <= monthsAhead; step += 1) {
      const anchor = history[history.length - 1].startDate;
      const targetDate = new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
      const targetIndex = syntheticHistory.length;
      const featureVector = buildFeatureVector(
        syntheticHistory,
        targetIndex,
        targetDate,
      );
      if (!featureVector) {
        break;
      }
      const incomeResult = predictWithModel(incomeModel, featureVector);
      const expenseResult = predictWithModel(expenseModel, featureVector);
      const income = Math.max(0, roundCurrency(incomeResult.prediction));
      const expense = Math.max(0, roundCurrency(expenseResult.prediction));
      const point = {
        key: formatMonthKey(targetDate),
        label: monthFormatter.format(targetDate),
        startDate: targetDate,
        expense,
        income,
      };
      forecast.push(point);
      syntheticHistory.push(point);

      if (step === 1) {
        const savings = roundCurrency(income - expense);
        contributions = {
          income: normalizeContributions(incomeResult.contributions),
          expense: normalizeContributions(expenseResult.contributions),
          savings: normalizeContributions(
            combineSavingsContributions(
              incomeResult.contributions,
              expenseResult.contributions,
            ),
          ),
          categories: {},
        };
        nextMonthSnapshot = { income, expense, savings };
      }
    }

    const insight = buildAiInsightText(
      nextMonthSnapshot,
      contributions.savings,
    );

    return {
      points: forecast,
      contributions,
      nextMonthSnapshot,
      insight,
    };
  }

  function buildFeatureVector(historyData, targetIndex, overrideDate) {
    const prevIndex = targetIndex - 1;
    const prev = historyData[prevIndex];
    if (!prev) {
      return null;
    }
    const prev2 = historyData[prevIndex - 1] || prev;
    const prev3 = historyData[prevIndex - 2] || prev2;

    const incomeWindow = historyData
      .slice(Math.max(0, prevIndex - 2), prevIndex + 1)
      .map((item) => toNumber(item.income));
    const expenseWindow = historyData
      .slice(Math.max(0, prevIndex - 2), prevIndex + 1)
      .map((item) => toNumber(item.expense));

    const targetDate =
      overrideDate ||
      historyData[targetIndex]?.startDate ||
      new Date(prev.startDate.getFullYear(), prev.startDate.getMonth() + 1, 1);
    const monthNumber = targetDate.getMonth() + 1;

    return {
      timeIndex: targetIndex + 1,
      prevIncome: toNumber(prev.income),
      prevExpense: toNumber(prev.expense),
      incomeMomentum: toNumber(prev.income) - toNumber(prev2.income),
      expenseMomentum: toNumber(prev.expense) - toNumber(prev2.expense),
      incomeAvg3: averageArray(incomeWindow),
      expenseAvg3: averageArray(expenseWindow),
      incomeVolatility: standardDeviation(incomeWindow),
      expenseVolatility: standardDeviation(expenseWindow),
      savingsPrev: toNumber(prev.income) - toNumber(prev.expense),
      expenseToIncomeRatioPrev:
        toNumber(prev.income) > 0
          ? toNumber(prev.expense) / toNumber(prev.income)
          : 0,
      seasonSin: Math.sin((2 * Math.PI * monthNumber) / 12),
      seasonCos: Math.cos((2 * Math.PI * monthNumber) / 12),
    };
  }

  function trainGradientBoosting(rows, featureKeys, options = {}) {
    if (!rows.length) {
      return null;
    }
    const maxTrees = options.trees || 8;
    const learningRate = options.learningRate || 0.3;
    const minSamples = options.minSamples || 2;

    const base =
      rows.reduce((sum, row) => sum + toNumber(row.target), 0) / rows.length;
    const predictions = rows.map(() => base);
    const trees = [];

    for (let round = 0; round < maxTrees; round += 1) {
      const residuals = rows.map(
        (row, idx) => toNumber(row.target) - predictions[idx],
      );
      const stump = findBestStump(rows, residuals, featureKeys, minSamples);
      if (!stump || stump.gain <= 0) {
        break;
      }
      const tree = { ...stump, lr: learningRate };
      trees.push(tree);
      rows.forEach((row, idx) => {
        const leafValue =
          row.features[tree.feature] <= tree.threshold
            ? tree.left
            : tree.right;
        predictions[idx] += learningRate * leafValue;
      });
      if (stump.gain < 1e-3) {
        break;
      }
    }

    return { base, trees, featureKeys };
  }

  function findBestStump(rows, residuals, featureKeys, minSamples) {
    const totalLoss = residuals.reduce((sum, value) => sum + value * value, 0);
    let best = null;

    featureKeys.forEach((feature) => {
      const pairs = rows
        .map((row, idx) => ({
          value: toNumber(row.features[feature]),
          residual: residuals[idx],
        }))
        .filter((pair) => Number.isFinite(pair.value));

      if (pairs.length < minSamples * 2) {
        return;
      }

      pairs.sort((a, b) => a.value - b.value);

      for (let index = 1; index < pairs.length; index += 1) {
        const left = pairs.slice(0, index);
        const right = pairs.slice(index);
        if (left.length < minSamples || right.length < minSamples) {
          continue;
        }
        const threshold =
          (pairs[index - 1].value + pairs[index].value) / 2 ||
          pairs[index].value;
        const leftMean =
          left.reduce((sum, item) => sum + item.residual, 0) / left.length;
        const rightMean =
          right.reduce((sum, item) => sum + item.residual, 0) / right.length;
        const lossLeft = left.reduce(
          (sum, item) => sum + (item.residual - leftMean) ** 2,
          0,
        );
        const lossRight = right.reduce(
          (sum, item) => sum + (item.residual - rightMean) ** 2,
          0,
        );
        const loss = lossLeft + lossRight;
        const gain = totalLoss - loss;

        if (!best || gain > best.gain) {
          best = {
            feature,
            threshold,
            left: leftMean,
            right: rightMean,
            gain,
          };
        }
      }
    });

    return best;
  }

  function predictWithModel(model, featureVector) {
    if (!model) {
      return { prediction: 0, contributions: [] };
    }

    let prediction = model.base;
    const contributionMap = new Map();
    contributionMap.set("bias", model.base);

    model.trees.forEach((tree) => {
      const leaf =
        featureVector[tree.feature] <= tree.threshold
          ? tree.left
          : tree.right;
      const impact = tree.lr * leaf;
      prediction += impact;
      contributionMap.set(
        tree.feature,
        (contributionMap.get(tree.feature) || 0) + impact,
      );
    });

    return {
      prediction,
      contributions: Array.from(contributionMap.entries()).map(
        ([feature, value]) => ({
          feature,
          value,
        }),
      ),
    };
  }

  function normalizeContributions(contributions) {
    return (contributions || [])
      .map((item) => ({
        feature: item.feature,
        value: roundCurrency(item.value),
      }))
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }

  function combineSavingsContributions(incomeContribs, expenseContribs) {
    const map = new Map();
    (incomeContribs || []).forEach((item) => {
      map.set(item.feature, (map.get(item.feature) || 0) + item.value);
    });
    (expenseContribs || []).forEach((item) => {
      map.set(item.feature, (map.get(item.feature) || 0) - item.value);
    });
    return Array.from(map.entries()).map(([feature, value]) => ({
      feature,
      value,
    }));
  }

  function buildAiInsightText(snapshot, savingsContribs) {
    if (!snapshot) {
      return "";
    }
    const topDriver =
      (savingsContribs || []).find((item) => item.feature !== "bias") || null;
    const driverLabel = topDriver
      ? featureLabels[topDriver.feature] || topDriver.feature
      : null;
    const direction = snapshot.savings >= 0 ? "surplus" : "shortfall";
    const headline = `AI projects a ${direction} of ${currencyFormatter.format(
      Math.abs(snapshot.savings),
    )} next month.`;
    const driverText = driverLabel
      ? `${driverLabel} is contributing a ${
          topDriver.value >= 0 ? "lift" : "drag"
        } of ${currencyFormatter.format(Math.abs(topDriver.value))}.`
      : "Forecast uses boosted decision-tree patterns from your recent history.";
    const riskText =
      snapshot.expense > snapshot.income
        ? "Alert: expenses are set to outpace income. Trim the top rising categories to avoid a cash squeeze."
        : "Opportunity: keep the surplus by locking in savings or paying down debt.";
    return `${headline} ${driverText} ${riskText}`;
  }

  async function computeCategoryOutlook(history) {
    if (!history.length) {
      return [];
    }

    const earliest = history[0].startDate;
    const latest = history[history.length - 1].startDate;
    const periodStart = formatDateForSql(earliest);
    const periodEnd = formatDateForSql(
      new Date(latest.getFullYear(), latest.getMonth() + 1, 1),
    );

    const monthLookup = new Map();
    history.forEach((item, index) => monthLookup.set(item.key, index));

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
      [periodStart, periodEnd],
    );

    const categorySeries = new Map();

    (categoryResult.rows || []).forEach((row) => {
      const name = (row.category || "Uncategorized").trim() || "Uncategorized";
      const periodKey = row.period;
      const monthIndex = monthLookup.get(periodKey);
      if (typeof monthIndex !== "number") {
        return;
      }
      const series = categorySeries.get(name) || new Array(history.length).fill(0);
      series[monthIndex] += toNumber(row.total);
      categorySeries.set(name, series);
    });

    const subscriptionResult = await database.query(
      `
        SELECT category, amount, billing_cycle
        FROM subscriptions
        WHERE IFNULL(is_paused, 0) = 0;
      `,
    );

    (subscriptionResult.rows || []).forEach((row) => {
      const name = (row.category || "Subscriptions").trim() || "Subscriptions";
      const series =
        categorySeries.get(name) || new Array(history.length).fill(0);
      const monthly = convertSubscriptionToMonthly(
        toNumber(row.amount),
        row.billing_cycle,
      );
      for (let index = 0; index < series.length; index += 1) {
        series[index] += monthly;
      }
      categorySeries.set(name, series);
    });

    const nextMonthDate = new Date(latest.getFullYear(), latest.getMonth() + 1, 1);

    const rows = Array.from(categorySeries.entries()).map(
      ([name, series]) => {
        const current = roundCurrency(series[series.length - 1] || 0);
        const previous =
          series.length > 1 ? roundCurrency(series[series.length - 2] || 0) : 0;
        const modelResult = buildCategoryForecast(series, history, nextMonthDate);
        const forecast =
          modelResult && modelResult.forecast != null
            ? modelResult.forecast
            : computeBaselineForecast(current, previous);
        const change = forecast - current;
        const changePct =
          current > 0 ? (change / current) * 100 : forecast > 0 ? 100 : 0;
        return {
          name,
          current,
          forecast,
          change,
          changePct,
          drivers: modelResult?.drivers || [],
          topDriver: modelResult?.topDriver || "",
          driverDirection: modelResult?.driverDirection || "neutral",
        };
      },
    );

    rows.sort((a, b) => b.current - a.current);
    return rows.slice(0, 6);
  }

  function computeBaselineForecast(current, previous) {
    const baseline = previous > 0 ? previous : current;
    const trend = previous > 0 ? current - previous : baseline * 0.05;
    return Math.max(0, roundCurrency(current + trend));
  }

  function buildCategoryForecast(series, history, nextMonthDate) {
    const featureKeys = [
      "prevValue",
      "momentum",
      "avg3",
      "volatility",
      "seasonSin",
      "seasonCos",
    ];

    const samples = [];
    for (let index = 1; index < series.length; index += 1) {
      const featureVector = buildCategoryFeatureVector(
        series,
        index,
        history[index]?.startDate,
      );
      if (!featureVector) {
        continue;
      }
      samples.push({
        features: featureVector,
        target: roundCurrency(series[index]),
      });
    }

    if (samples.length < 2) {
      return null;
    }

    const model = trainGradientBoosting(samples, featureKeys, {
      trees: 6,
      learningRate: 0.35,
    });

    if (!model) {
      return null;
    }

    const featureVector = buildCategoryFeatureVector(
      series,
      series.length,
      nextMonthDate,
    );
    if (!featureVector) {
      return null;
    }

    const result = predictWithModel(model, featureVector);
    const normalizedDrivers = normalizeContributions(result.contributions);
    const topDriver = normalizedDrivers.find((item) => item.feature !== "bias");

    return {
      forecast: Math.max(0, roundCurrency(result.prediction)),
      drivers: normalizedDrivers,
      topDriver: topDriver
        ? featureLabels[topDriver.feature] || topDriver.feature
        : "",
      driverDirection: topDriver
        ? topDriver.value >= 0
          ? "positive"
          : "negative"
        : "neutral",
    };
  }

  function buildCategoryFeatureVector(series, targetIndex, targetDate) {
    const prevIndex = targetIndex - 1;
    const prevValue = toNumber(series[prevIndex]);
    if (!Number.isFinite(prevValue)) {
      return null;
    }
    const prev2Value = toNumber(series[prevIndex - 1] ?? prevValue);
    const window = series
      .slice(Math.max(0, prevIndex - 2), prevIndex + 1)
      .map((value) => toNumber(value));
    const monthNumber = (targetDate || new Date()).getMonth() + 1;

    return {
      prevValue,
      momentum: prevValue - prev2Value,
      avg3: averageArray(window),
      volatility: standardDeviation(window),
      seasonSin: Math.sin((2 * Math.PI * monthNumber) / 12),
      seasonCos: Math.cos((2 * Math.PI * monthNumber) / 12),
    };
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
        index === history.length - 1 ? roundCurrency(month.expense) : null,
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
      if (item.topDriver) {
        const driverChip = document.createElement("span");
        driverChip.classList.add("driver-chip");
        if (item.driverDirection === "positive") {
          driverChip.classList.add("positive");
        } else if (item.driverDirection === "negative") {
          driverChip.classList.add("negative");
        }
        driverChip.textContent = item.topDriver;
        nameCell.appendChild(document.createTextNode(" "));
        nameCell.appendChild(driverChip);
      }

      const rangeCell = document.createElement("td");
      rangeCell.innerHTML = `${currencyFormatter.format(
        item.current,
      )} → ${currencyFormatter.format(
        item.forecast,
      )} <span class="range-text">${percentFormatter.format(
        item.changePct / 100,
      )}</span>`;

      const pillCell = document.createElement("td");
      const pill = document.createElement("span");
      pill.classList.add(
        "trend-pill",
        changePositive ? "positive" : "negative",
      );
      pill.innerHTML = `
        <i class="fas ${changePositive ? "fa-arrow-down" : "fa-arrow-up"}"></i>
        ${percentFormatter.format(Math.abs(item.changePct) / 100)}
      `;
      pillCell.appendChild(pill);

      const deltaCell = document.createElement("td");
      deltaCell.classList.add(
        "delta",
        changePositive ? "positive" : "negative",
      );
      deltaCell.textContent =
        item.change === 0
          ? currencyFormatter.format(0)
          : `${item.change > 0 ? "+" : "-"}${currencyFormatter.format(
              Math.abs(item.change),
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
        Math.abs(state.trendSummary.actualChangePct) / 100,
      );
      const projectedPercent = percentFormatter.format(
        Math.abs(state.trendSummary.projectedChangePct) / 100,
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
        Math.abs(state.incomeSummary.projectedChangePct) / 100,
      );
      elements.insightIncomeTitle.textContent = "Income Outlook";
      elements.insightIncomeText.textContent =
        state.incomeSummary.projectedChangePct === 0
          ? "Income is projected to stay consistent based on recent trends."
          : `Income is projected to ${projectedDirection} by ${projectedPercent} over the next quarter.`;
    }

    if (state.riskCategory) {
      const changePercent = percentFormatter.format(
        Math.abs(state.riskCategory.changePct) / 100,
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

  function updateAiExplainability() {
    if (!elements.aiIncomePred) {
      return;
    }

    if (!state.nextMonthSnapshot) {
      elements.aiIncomePred.textContent = "--";
      elements.aiExpensePred.textContent = "--";
      elements.aiSavingsPred.textContent = "--";
      elements.aiIncomeDriver.textContent = "Need more history";
      elements.aiExpenseDriver.textContent = "Need more history";
      elements.aiSavingsDriver.textContent = "Need more history";
      if (elements.aiModelPill) {
        elements.aiModelPill.textContent = "Learning";
      }
      if (elements.aiDriverList) {
        elements.aiDriverList.innerHTML =
          "<li class=\"driver-row\">Add a few months of data to unlock AI explanations.</li>";
      }
      if (elements.aiInsightText) {
        elements.aiInsightText.textContent =
          "AI insights will activate once recent income and expense trends are available.";
      }
      renderCategoryHotspots();
      return;
    }

    const { income, expense, savings } = state.nextMonthSnapshot;
    elements.aiIncomePred.textContent = currencyFormatter.format(income);
    elements.aiExpensePred.textContent = currencyFormatter.format(expense);
    elements.aiSavingsPred.textContent = currencyFormatter.format(savings);

    const incomeTop = (state.aiContributions.income || []).find(
      (item) => item.feature !== "bias",
    );
    const expenseTop = (state.aiContributions.expense || []).find(
      (item) => item.feature !== "bias",
    );
    const savingsTop = (state.aiContributions.savings || []).find(
      (item) => item.feature !== "bias",
    );

    elements.aiIncomeDriver.textContent = incomeTop
      ? formatDriverLabel(incomeTop)
      : "Model baseline";
    elements.aiExpenseDriver.textContent = expenseTop
      ? formatDriverLabel(expenseTop)
      : "Model baseline";
    elements.aiSavingsDriver.textContent = savingsTop
      ? formatDriverLabel(savingsTop)
      : "Model baseline";

    if (elements.aiModelPill) {
      elements.aiModelPill.textContent = "Tree Boosted";
    }

    renderDriverList(elements.aiDriverList, state.aiContributions.savings);
    renderCategoryHotspots();

    if (elements.aiInsightText) {
      elements.aiInsightText.textContent =
        state.aiInsight ||
        "Boosted trees are ready. Adjust spending to keep the projected surplus trending up.";
    }
  }

  function formatDriverLabel(contribution) {
    const label = featureLabels[contribution.feature] || contribution.feature;
    const direction = contribution.value >= 0 ? "up" : "down";
    return `${label} nudging ${direction}`;
  }

  function renderDriverList(targetElement, contributions) {
    if (!targetElement) {
      return;
    }
    targetElement.innerHTML = "";
    const filtered = (contributions || []).filter(
      (item) => item.feature && item.feature !== "bias",
    );
    if (!filtered.length) {
      targetElement.innerHTML =
        "<li class=\"driver-row\">Not enough data for explanations yet.</li>";
      return;
    }

    filtered.slice(0, 4).forEach((item) => {
      const li = document.createElement("li");
      li.classList.add("driver-row", item.value >= 0 ? "positive" : "negative");
      const label = featureLabels[item.feature] || item.feature;
      li.innerHTML = `
        <span class="driver-label">${label}</span>
        <span class="driver-impact">${
          item.value >= 0 ? "+" : "-"
        }${currencyFormatter.format(Math.abs(item.value))}</span>
      `;
      targetElement.appendChild(li);
    });
  }

  function renderCategoryHotspots() {
    if (!elements.aiCategoryList) {
      return;
    }
    elements.aiCategoryList.innerHTML = "";
    if (!state.categoryRows.length) {
      elements.aiCategoryList.innerHTML =
        "<li class=\"driver-row\">Add transactions to see category hotspots.</li>";
      return;
    }

    const sorted = [...state.categoryRows]
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 3);

    sorted.forEach((row) => {
      const li = document.createElement("li");
      li.classList.add("driver-row", row.change > 0 ? "negative" : "positive");
      li.innerHTML = `
        <span class="driver-label">${row.name}</span>
        <span class="driver-impact">${percentFormatter.format(
          Math.abs(row.changePct) / 100,
        )}</span>
      `;
      elements.aiCategoryList.appendChild(li);
    });
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
        error.message,
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

  function averageArray(values) {
    if (!values || !values.length) {
      return 0;
    }
    const sum = values.reduce((acc, value) => acc + toNumber(value), 0);
    return sum / values.length;
  }

  function standardDeviation(values) {
    if (!values || !values.length) {
      return 0;
    }
    const mean = averageArray(values);
    const variance =
      values.reduce(
        (acc, value) => acc + (toNumber(value) - mean) ** 2,
        0,
      ) / values.length;
    return Math.sqrt(variance);
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
        is_paused INTEGER DEFAULT 0,
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
