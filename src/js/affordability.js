const database = require("../../electron/db");
const transactionsStore = require("../../electron/models/transactions");

const dependencyError = database.dependencyError;

document.addEventListener("DOMContentLoaded", async () => {
  const state = {
    monthlyIncome: 0,
    transactionExpenses: 0,
    subscriptionMonthly: 0,
    monthlyExpenses: 0,
    monthlySavings: 0,
    safeUpfrontLimit: 0,
    safeMonthlyAllocation: 0,
    availableForPurchase: 0,
    lastUpdated: null,
    emergencyBufferMonths: 3,
    paymentPlans: {
      "pay-in-full": {
        label: "Pay in Full (One-time)",
        months: 1,
        interest: 0,
        description: "Uses your current savings for a one-time payment.",
      },
      "emi-3": {
        label: "3-Month EMI",
        months: 3,
        interest: 0.015,
        description:
          "Short-term EMI with a 1.5% service charge distributed across 3 months.",
      },
      "emi-6": {
        label: "6-Month EMI",
        months: 6,
        interest: 0.035,
        description: "Balanced EMI option with a 3.5% total finance cost.",
      },
      "emi-12": {
        label: "12-Month EMI",
        months: 12,
        interest: 0.065,
        description:
          "Long-term EMI with a 6.5% total finance cost for maximum flexibility.",
      },
      "emi-24": {
        label: "24-Month EMI",
        months: 24,
        interest: 0.095,
        description:
          "Extended EMI with a 9.5% total finance cost for the lowest monthly payments.",
      },
    },
  };

  const SAFE_UPFRONT_RATIO = 0.9;
  const SAFE_MONTHLY_RATIO = 0.6;

  const BILLING_CYCLES = {
    Weekly: {
      toMonthly: (amount) => toNumber(amount) * (52 / 12),
    },
    Monthly: {
      toMonthly: (amount) => toNumber(amount),
    },
    Quarterly: {
      toMonthly: (amount) => toNumber(amount) / 3,
    },
    Semiannual: {
      toMonthly: (amount) => toNumber(amount) / 6,
    },
    Yearly: {
      toMonthly: (amount) => toNumber(amount) / 12,
    },
  };

  const elements = {
    form: document.querySelector("#affordability-form"),
    amountInput: document.querySelector("#purchase-amount"),
    planSelect: document.querySelector("#payment-plan"),
    planDescription: document.querySelector("#plan-description"),
    formFeedback: document.querySelector("#form-feedback"),
    formFeedbackText: document.querySelector("#form-feedback p"),
    resultContainer: document.querySelector("#affordability-result"),
    resultStatus: document.querySelector("#result-status"),
    resultText: document.querySelector("#result-text"),
    resultMonthlyPayment: document.querySelector("#result-monthly-payment"),
    resultMonthlyDetail: document.querySelector("#result-monthly-detail"),
    resultPlanLength: document.querySelector("#result-plan-length"),
    resultTotalCost: document.querySelector("#result-total-cost"),
    resultSavingsImpact: document.querySelector("#result-savings-impact"),
    resultImpactDetail: document.querySelector("#result-impact-detail"),
    resultRecommendation: document.querySelector("#result-recommendation"),
    resultExtraTip: document.querySelector("#result-extra-tip"),
    overviewIncome: document.querySelector("#overview-income"),
    overviewExpenses: document.querySelector("#overview-expenses"),
    overviewSubscriptions: document.querySelector("#overview-subscriptions"),
    overviewSavings: document.querySelector("#overview-savings"),
    availableForPurchase: document.querySelector("#available-for-purchase"),
    safeMonthlyAllocation: document.querySelector("#safe-monthly-allocation"),
    savingsProgress: document.querySelector("#savings-progress"),
    savingsProgressLabel: document.querySelector("#savings-progress-label"),
    overviewLastUpdated: document.querySelector("#overview-last-updated"),
    greeting: document.querySelector("#affordability-greeting"),
    avatar: document.querySelector(".header-actions .avatar"),
  };

  const locale = process.env.FINLYTICS_LOCALE || "en-IN";
  const currencyCode = process.env.FINLYTICS_CURRENCY || "INR";

  let currencyFormatter;
  try {
    currencyFormatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    });
  } catch (error) {
    console.warn(
      "Finlytics affordability: falling back to INR currency format:",
      error.message
    );
    currencyFormatter = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    });
  }

  let percentFormatter;
  try {
    percentFormatter = new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 0,
    });
  } catch (_error) {
    percentFormatter = new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 0,
    });
  }

  let dateTimeFormatter;
  try {
    dateTimeFormatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (_error) {
    dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function disableForm() {
    elements.amountInput?.setAttribute("disabled", "disabled");
    elements.planSelect?.setAttribute("disabled", "disabled");
    elements.form
      ?.querySelector("button[type='submit']")
      ?.setAttribute("disabled", "disabled");
  }

  function formatCurrency(value) {
    const numeric = toNumber(value);
    return currencyFormatter.format(Math.round(numeric));
  }

  function formatLastUpdated(date) {
    try {
      return dateTimeFormatter.format(date);
    } catch (_error) {
      return date.toLocaleString();
    }
  }

  function calculateTotals(amount, plan) {
    const totalCost = amount * (1 + plan.interest);
    const monthlyPayment = totalCost / plan.months;
    return { totalCost, monthlyPayment };
  }

  function showFeedback(message, variant = "neutral") {
    if (!elements.formFeedback || !elements.formFeedbackText) {
      return;
    }
    elements.formFeedback.classList.remove("hidden", "positive", "negative");
    if (variant === "positive") {
      elements.formFeedback.classList.add("positive");
    } else if (variant === "negative") {
      elements.formFeedback.classList.add("negative");
    }
    elements.formFeedbackText.textContent = message;
  }

  function hideFeedback() {
    if (!elements.formFeedback || !elements.formFeedbackText) {
      return;
    }
    elements.formFeedback.classList.add("hidden");
    elements.formFeedback.classList.remove("positive", "negative");
    elements.formFeedbackText.textContent = "";
  }

  function updateOverview() {
    setOverviewValue(elements.overviewIncome, state.monthlyIncome, "income");
    setOverviewValue(
      elements.overviewExpenses,
      state.monthlyExpenses,
      "expense"
    );
    setOverviewValue(
      elements.overviewSubscriptions,
      state.subscriptionMonthly,
      "expense"
    );
    setOverviewValue(elements.overviewSavings, state.monthlySavings, "savings");
    setOverviewValue(
      elements.availableForPurchase,
      state.availableForPurchase,
      "income"
    );
    setOverviewValue(
      elements.safeMonthlyAllocation,
      state.safeMonthlyAllocation,
      "info"
    );

    if (elements.overviewLastUpdated) {
      elements.overviewLastUpdated.textContent = state.lastUpdated
        ? `Last updated ${formatLastUpdated(state.lastUpdated)}`
        : "Last updated: not available";
    }
  }

  function setOverviewValue(element, value, kind) {
    if (!element) {
      return;
    }
    element.classList.remove("positive", "negative", "info");
    const numeric = toNumber(value);

    if (kind === "expense") {
      element.classList.add("negative");
    } else if (kind === "savings") {
      element.classList.add(numeric >= 0 ? "positive" : "negative");
    } else if (kind === "info") {
      if (numeric > 0) {
        element.classList.add("info");
      } else if (numeric < 0) {
        element.classList.add("negative");
      } else {
        element.classList.add("info");
      }
    } else {
      element.classList.add(numeric >= 0 ? "positive" : "negative");
    }

    element.textContent = formatCurrency(numeric);
  }

  function updateProgress(ratio, descriptor, safeBudget = null) {
    if (!elements.savingsProgress || !elements.savingsProgressLabel) {
      return;
    }

    elements.savingsProgress.classList.remove("over-limit");

    if (!Number.isFinite(ratio)) {
      elements.savingsProgress.style.width = "100%";
      elements.savingsProgress.classList.add("over-limit");
      elements.savingsProgressLabel.textContent =
        safeBudget && safeBudget > 0
          ? `${descriptor} exceeds your safe budget.`
          : "No safe allocation available yet.";
      return;
    }

    const clamped = Math.min(1, Math.max(0, ratio));
    elements.savingsProgress.style.width = `${clamped * 100}%`;

    if (ratio > 1) {
      elements.savingsProgress.classList.add("over-limit");
      elements.savingsProgressLabel.textContent = `${descriptor} exceeds your safe budget by ${percentFormatter.format(
        ratio - 1
      )}.`;
    } else if (ratio === 0) {
      elements.savingsProgressLabel.textContent = "No plan selected yet.";
    } else {
      elements.savingsProgressLabel.textContent = `${descriptor} uses ${percentFormatter.format(
        ratio
      )} of your safe allocation.`;
    }
  }

  function renderResult({
    amount,
    plan,
    totalCost,
    monthlyPayment,
    affordable,
    difference,
    ratio,
    safeBudget,
  }) {
    elements.resultContainer?.classList.remove(
      "hidden",
      "negative",
      "positive"
    );
    elements.resultContainer?.classList.add(
      affordable ? "positive" : "negative"
    );

    if (elements.resultStatus) {
      elements.resultStatus.textContent = affordable
        ? "Affordable"
        : "Hold Off";
    }
    if (elements.resultMonthlyPayment) {
      elements.resultMonthlyPayment.textContent =
        formatCurrency(monthlyPayment);
    }
    if (elements.resultPlanLength) {
      elements.resultPlanLength.textContent =
        plan.months === 1 ? "One-time" : `${plan.months} months`;
    }
    if (elements.resultTotalCost) {
      elements.resultTotalCost.textContent = `Total cost: ${formatCurrency(
        totalCost
      )}`;
    }

    const differenceAbsolute = Math.abs(difference);
    const differenceFormatted = formatCurrency(differenceAbsolute);

    if (plan.months === 1) {
      const safeLimit = safeBudget;
      if (elements.resultSavingsImpact) {
        elements.resultSavingsImpact.textContent = `${formatCurrency(
          amount
        )} upfront`;
      }
      if (elements.resultImpactDetail) {
        elements.resultImpactDetail.textContent = `Safe limit: ${formatCurrency(
          safeLimit
        )}`;
      }
      if (elements.resultRecommendation) {
        elements.resultRecommendation.textContent =
          safeLimit > 0
            ? affordable
              ? "Proceed with confidence"
              : "Reduce the amount"
            : "Build savings first";
      }
      if (elements.resultExtraTip) {
        elements.resultExtraTip.textContent =
          safeLimit > 0
            ? affordable
              ? "Tip: Keep three months of savings aside for emergencies."
              : `Tip: Trim ${differenceFormatted} or choose an EMI plan.`
            : "Tip: Add income transactions or lower expenses to create a savings buffer.";
      }
      if (elements.resultText) {
        elements.resultText.textContent =
          safeLimit > 0
            ? affordable
              ? "You can comfortably afford this purchase with your current savings."
              : "This purchase is higher than your safe one-time spending limit."
            : "Your current savings are not ready for one-time purchases.";
      }
      updateProgress(ratio, "This purchase", safeLimit);
    } else {
      const safeAllocation = safeBudget;
      if (elements.resultSavingsImpact) {
        elements.resultSavingsImpact.textContent = `${formatCurrency(
          monthlyPayment
        )} per month`;
      }
      if (elements.resultImpactDetail) {
        elements.resultImpactDetail.textContent = `Safe allocation: ${formatCurrency(
          safeAllocation
        )}`;
      }
      if (elements.resultRecommendation) {
        elements.resultRecommendation.textContent =
          safeAllocation > 0
            ? affordable
              ? "Plan looks good"
              : "Adjust plan or amount"
            : "Build savings first";
      }
      if (elements.resultExtraTip) {
        elements.resultExtraTip.textContent =
          safeAllocation > 0
            ? affordable
              ? "Tip: You will still retain a savings buffer after this EMI."
              : `Tip: Lower the purchase by ${differenceFormatted} or pick a longer tenure.`
            : "Tip: Boost your monthly savings before committing to EMIs.";
      }
      if (elements.resultText) {
        elements.resultText.textContent =
          safeAllocation > 0
            ? affordable
              ? "Your EMI fits comfortably within your monthly savings."
              : "This EMI would use more than the safe portion of your savings."
            : "Your current savings do not support new EMIs yet.";
      }
      updateProgress(ratio, "This EMI", safeAllocation);
    }

    const deltaText =
      difference >= 0
        ? `You will have ${formatCurrency(
            difference
          )} remaining in your safe allocation.`
        : `You exceed the safe allocation by ${differenceFormatted}.`;
    if (elements.resultMonthlyDetail) {
      elements.resultMonthlyDetail.textContent =
        safeBudget > 0
          ? plan.months === 1
            ? `One-time payment of ${formatCurrency(amount)}. ${deltaText}`
            : `${plan.months} instalments of ${formatCurrency(
                monthlyPayment
              )}. ${deltaText}`
          : "Increase your savings before committing to this plan.";
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const amount = Number(elements.amountInput?.value || "0");
    const plan = state.paymentPlans[elements.planSelect?.value];

    if (!plan) {
      showFeedback("Select a payment plan to continue.", "negative");
      return;
    }

    if (!amount || Number.isNaN(amount) || amount <= 0) {
      showFeedback(
        "Please enter a purchase amount greater than zero.",
        "negative"
      );
      elements.resultContainer?.classList.add("hidden");
      updateProgress(0, "This plan");
      return;
    }

    hideFeedback();

    const { totalCost, monthlyPayment } = calculateTotals(amount, plan);
    const safeBudget =
      plan.months === 1 ? state.safeUpfrontLimit : state.safeMonthlyAllocation;

    const ratio =
      safeBudget > 0
        ? plan.months === 1
          ? amount / safeBudget
          : monthlyPayment / safeBudget
        : Infinity;

    const targetValue = plan.months === 1 ? amount : monthlyPayment;
    const difference = safeBudget > 0 ? safeBudget - targetValue : -targetValue;
    const affordable =
      safeBudget > 0 && Number.isFinite(ratio) && ratio <= 1 + Number.EPSILON;

    renderResult({
      amount,
      plan,
      totalCost,
      monthlyPayment,
      affordable,
      difference,
      ratio,
      safeBudget,
    });
  }

  function handlePlanChange() {
    const plan = state.paymentPlans[elements.planSelect?.value];
    if (plan && elements.planDescription) {
      elements.planDescription.textContent = plan.description;
    }
    if (!elements.amountInput?.value) {
      if (state.safeMonthlyAllocation > 0 || state.safeUpfrontLimit > 0) {
        updateProgress(0, "This plan");
      }
    }
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

      if (elements.avatar && fullName) {
        elements.avatar.textContent = fullName.charAt(0).toUpperCase() || "F";
      }
    } catch (error) {
      console.warn(
        "Finlytics affordability: unable to load user profile",
        error
      );
    }
  }

  async function loadFinancialSnapshot() {
    try {
      const snapshot = await computeFinancialSnapshot();
      applySnapshot(snapshot);
      updateOverview();
      maybeShowSnapshotFeedback(snapshot);
    } catch (error) {
      console.error("Finlytics affordability: snapshot failed", error);
      showFeedback(
        `Unable to load your finances: ${database.normalizeDbError(error)}`,
        "negative"
      );
    }
  }

  async function computeFinancialSnapshot() {
    await transactionsStore.ensureTransactionTable();
    await ensureSubscriptionsTable();

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [transactionTotals, subscriptionRows] = await Promise.all([
      database.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
        FROM "transaction"
        WHERE occurred_at >= ? AND occurred_at < ?;
      `,
        [formatDateForSql(start), formatDateForSql(end)]
      ),
      database.query(
        `
        SELECT amount, billing_cycle
        FROM subscriptions;
      `
      ),
    ]);

    const income = toNumber(transactionTotals.rows?.[0]?.income);
    const transactionExpenses = toNumber(transactionTotals.rows?.[0]?.expenses);

    const subscriptionMonthly = (subscriptionRows.rows || []).reduce(
      (accumulator, row) =>
        accumulator +
        convertSubscriptionToMonthly(row.amount, row.billing_cycle),
      0
    );

    const monthlyExpenses = transactionExpenses + subscriptionMonthly;
    const monthlySavings = income - monthlyExpenses;

    const safeMonthlyAllocation =
      monthlySavings > 0 ? monthlySavings * SAFE_MONTHLY_RATIO : 0;
    const safeUpfrontLimit =
      monthlySavings > 0 ? monthlySavings * SAFE_UPFRONT_RATIO : 0;
    const availableForPurchase = monthlySavings > 0 ? monthlySavings : 0;

    return {
      monthlyIncome: income,
      transactionExpenses,
      subscriptionMonthly,
      monthlyExpenses,
      monthlySavings,
      safeMonthlyAllocation,
      safeUpfrontLimit,
      availableForPurchase,
      lastUpdated: new Date(),
    };
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

  function applySnapshot(snapshot) {
    state.monthlyIncome = snapshot.monthlyIncome;
    state.transactionExpenses = snapshot.transactionExpenses;
    state.subscriptionMonthly = snapshot.subscriptionMonthly;
    state.monthlyExpenses = snapshot.monthlyExpenses;
    state.monthlySavings = snapshot.monthlySavings;
    state.safeMonthlyAllocation = snapshot.safeMonthlyAllocation;
    state.safeUpfrontLimit = snapshot.safeUpfrontLimit;
    state.availableForPurchase = snapshot.availableForPurchase;
    state.lastUpdated = snapshot.lastUpdated;
  }

  function maybeShowSnapshotFeedback(snapshot) {
    const hasIncome = snapshot.monthlyIncome > 0;
    const hasCosts =
      snapshot.transactionExpenses > 0 || snapshot.subscriptionMonthly > 0;

    if (!hasIncome && !hasCosts) {
      showFeedback(
        "Add income, expenses, or subscriptions to personalize affordability insights."
      );
      updateProgress(0, "This plan");
      return;
    }

    if (snapshot.safeMonthlyAllocation <= 0 || snapshot.safeUpfrontLimit <= 0) {
      showFeedback(
        "Your current savings are at or below zero. Add income or trim expenses to unlock purchase recommendations.",
        "negative"
      );
      updateProgress(Infinity, "This plan");
      return;
    }

    hideFeedback();
    updateProgress(0, "This plan");
  }

  function convertSubscriptionToMonthly(amount, billingCycle) {
    const cycle = BILLING_CYCLES[billingCycle] || BILLING_CYCLES.Monthly;
    return cycle.toMonthly(amount);
  }

  function formatDateForSql(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  elements.form?.addEventListener("submit", handleSubmit);
  elements.planSelect?.addEventListener("change", handlePlanChange);

  updateProgress(0, "This plan");
  elements.resultContainer?.classList.add("hidden");

  if (dependencyError) {
    showFeedback(
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`,
      "negative"
    );
    disableForm();
    return;
  }

  await loadProfile();
  await loadFinancialSnapshot();
  handlePlanChange();
});
