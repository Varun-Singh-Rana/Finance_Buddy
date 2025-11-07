document.addEventListener("DOMContentLoaded", () => {
  const state = {
    monthlyIncome: 400000,
    monthlyExpenses: 336000,
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
    },
  };

  state.monthlySavings = state.monthlyIncome - state.monthlyExpenses;
  state.safeUpfrontLimit = state.monthlySavings * 0.9;
  state.safeMonthlyAllocation = state.monthlySavings * 0.6;
  state.availableForPurchase = state.monthlySavings;

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
    overviewSavings: document.querySelector("#overview-savings"),
    availableForPurchase: document.querySelector("#available-for-purchase"),
    safeMonthlyAllocation: document.querySelector("#safe-monthly-allocation"),
    savingsProgress: document.querySelector("#savings-progress"),
    savingsProgressLabel: document.querySelector("#savings-progress-label"),
  };

  const currencyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const percentFormatter = new Intl.NumberFormat("en-IN", {
    style: "percent",
    maximumFractionDigits: 0,
  });

  function formatCurrency(value) {
    return currencyFormatter.format(Math.round(value));
  }

  function calculateTotals(amount, plan) {
    const totalCost = amount * (1 + plan.interest);
    const monthlyPayment = totalCost / plan.months;
    return { totalCost, monthlyPayment };
  }

  function showFeedback(message, variant = "neutral") {
    elements.formFeedback.classList.remove("hidden", "positive", "negative");
    if (variant === "positive") {
      elements.formFeedback.classList.add("positive");
    } else if (variant === "negative") {
      elements.formFeedback.classList.add("negative");
    }
    elements.formFeedbackText.textContent = message;
  }

  function hideFeedback() {
    elements.formFeedback.classList.add("hidden");
    elements.formFeedback.classList.remove("positive", "negative");
    elements.formFeedbackText.textContent = "";
  }

  function updateOverview() {
    elements.overviewIncome.textContent = formatCurrency(state.monthlyIncome);
    elements.overviewExpenses.textContent = formatCurrency(
      state.monthlyExpenses
    );
    elements.overviewSavings.textContent = formatCurrency(state.monthlySavings);
    elements.availableForPurchase.textContent = formatCurrency(
      state.availableForPurchase
    );
    elements.safeMonthlyAllocation.textContent = formatCurrency(
      state.safeMonthlyAllocation
    );
  }

  function updateProgress(ratio, descriptor) {
    const clamped = Math.min(1, Math.max(0, ratio));
    elements.savingsProgress.style.width = `${clamped * 100}%`;
    if (ratio > 1) {
      elements.savingsProgress.classList.add("over-limit");
      elements.savingsProgressLabel.textContent = `${descriptor} exceeds your safe budget by ${percentFormatter.format(
        ratio - 1
      )}.`;
    } else if (ratio === 0) {
      elements.savingsProgress.classList.remove("over-limit");
      elements.savingsProgressLabel.textContent = "No plan selected yet.";
    } else {
      elements.savingsProgress.classList.remove("over-limit");
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
  }) {
    elements.resultContainer.classList.remove("hidden", "negative", "positive");
    elements.resultContainer.classList.add(
      affordable ? "positive" : "negative"
    );

    elements.resultStatus.textContent = affordable ? "Affordable" : "Hold Off";
    elements.resultMonthlyPayment.textContent = formatCurrency(monthlyPayment);
    elements.resultPlanLength.textContent =
      plan.months === 1 ? "One-time" : `${plan.months} months`;
    elements.resultTotalCost.textContent = `Total cost: ${formatCurrency(
      totalCost
    )}`;

    const differenceAbsolute = Math.abs(difference);
    const differenceFormatted = formatCurrency(differenceAbsolute);

    if (plan.months === 1) {
      const safeLimit = state.safeUpfrontLimit;
      elements.resultSavingsImpact.textContent = `${formatCurrency(
        amount
      )} upfront`;
      elements.resultImpactDetail.textContent = `Safe limit: ${formatCurrency(
        safeLimit
      )}`;
      elements.resultRecommendation.textContent = affordable
        ? "Proceed with confidence"
        : "Reduce the amount";
      elements.resultExtraTip.textContent = affordable
        ? "Tip: Keep three months of savings aside for emergencies."
        : `Tip: Trim ${differenceFormatted} or choose an EMI plan.`;
      elements.resultText.textContent = affordable
        ? "You can comfortably afford this purchase with your current savings."
        : "This purchase is higher than your safe one-time spending limit.";
      updateProgress(ratio, "This purchase");
    } else {
      const safeAllocation = state.safeMonthlyAllocation;
      elements.resultSavingsImpact.textContent = `${formatCurrency(
        monthlyPayment
      )} per month`;
      elements.resultImpactDetail.textContent = `Safe allocation: ${formatCurrency(
        safeAllocation
      )}`;
      elements.resultRecommendation.textContent = affordable
        ? "Plan looks good"
        : "Adjust plan or amount";
      elements.resultExtraTip.textContent = affordable
        ? "Tip: You will still retain a savings buffer after this EMI."
        : `Tip: Lower the purchase by ${differenceFormatted} or pick a longer tenure.`;
      elements.resultText.textContent = affordable
        ? "Your EMI fits comfortably within your monthly savings."
        : "This EMI would use more than the safe portion of your savings.";
      updateProgress(ratio, "This EMI");
    }

    const deltaText =
      difference >= 0
        ? `You will have ${formatCurrency(
            difference
          )} remaining in your safe allocation.`
        : `You exceed the safe allocation by ${differenceFormatted}.`;
    elements.resultMonthlyDetail.textContent =
      plan.months === 1
        ? `One-time payment of ${formatCurrency(amount)}. ${deltaText}`
        : `${plan.months} instalments of ${formatCurrency(
            monthlyPayment
          )}. ${deltaText}`;
  }

  function handleSubmit(event) {
    event.preventDefault();
    const amount = Number(elements.amountInput.value);
    const plan = state.paymentPlans[elements.planSelect.value];

    if (!amount || Number.isNaN(amount) || amount <= 0) {
      showFeedback(
        "Please enter a purchase amount greater than zero.",
        "negative"
      );
      elements.resultContainer.classList.add("hidden");
      updateProgress(0, "This plan");
      return;
    }

    hideFeedback();

    const { totalCost, monthlyPayment } = calculateTotals(amount, plan);
    const ratio =
      plan.months === 1
        ? amount / state.safeUpfrontLimit
        : monthlyPayment / state.safeMonthlyAllocation;
    const difference =
      plan.months === 1
        ? state.safeUpfrontLimit - amount
        : state.safeMonthlyAllocation - monthlyPayment;
    const affordable = ratio <= 1;

    renderResult({
      amount,
      plan,
      totalCost,
      monthlyPayment,
      affordable,
      difference,
      ratio,
    });
  }

  function handlePlanChange() {
    const plan = state.paymentPlans[elements.planSelect.value];
    elements.planDescription.textContent = plan.description;
    if (!elements.amountInput.value) {
      updateProgress(0, "This plan");
    }
  }

  updateOverview();
  handlePlanChange();

  elements.form.addEventListener("submit", handleSubmit);
  elements.planSelect.addEventListener("change", handlePlanChange);
});
