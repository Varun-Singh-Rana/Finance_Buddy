document.addEventListener("DOMContentLoaded", () => {
  const reports = [
    {
      id: "monthly-expense",
      title: "Monthly Expense Report",
      type: "expense",
      typeLabel: "Expense Analysis",
      icon: "fa-chart-pie",
      periodLabel: "September 2025",
      generatedOn: "2025-10-01",
      fileSize: "1.2 MB",
      format: "PDF",
      timeframes: [
        "this-month",
        "last-month",
        "last-quarter",
        "this-year",
        "all-time",
      ],
      highlight: { text: "-4% vs last quarter", sentiment: "negative" },
      keywords: ["spending", "budget"],
    },
    {
      id: "income-statement",
      title: "Income Statement",
      type: "income",
      typeLabel: "Income",
      icon: "fa-sack-dollar",
      periodLabel: "Q3 2025",
      generatedOn: "2025-10-01",
      fileSize: "856 KB",
      format: "PDF",
      timeframes: [
        "this-month",
        "last-month",
        "last-quarter",
        "this-year",
        "all-time",
      ],
      highlight: { text: "+6% QoQ", sentiment: "positive" },
      keywords: ["earnings", "statement"],
    },
    {
      id: "savings-progress",
      title: "Savings Progress Report",
      type: "savings",
      typeLabel: "Savings",
      icon: "fa-piggy-bank",
      periodLabel: "September 2025",
      generatedOn: "2025-10-01",
      fileSize: "645 KB",
      format: "XLSX",
      timeframes: ["this-month", "last-quarter", "this-year", "all-time"],
      highlight: { text: "+₹38,400 saved", sentiment: "positive" },
      keywords: ["goals", "progress"],
    },
    {
      id: "tax-summary",
      title: "Tax Summary",
      type: "tax",
      typeLabel: "Tax",
      icon: "fa-scale-balanced",
      periodLabel: "YTD 2025",
      generatedOn: "2025-09-30",
      fileSize: "2.1 MB",
      format: "PDF",
      timeframes: ["this-year", "all-time"],
      highlight: { text: "Ready for filing", sentiment: "neutral" },
      keywords: ["gst", "returns"],
    },
    {
      id: "cash-flow",
      title: "Quarterly Cash Flow",
      type: "expense",
      typeLabel: "Expense Analysis",
      icon: "fa-chart-column",
      periodLabel: "Q3 2025",
      generatedOn: "2025-10-05",
      fileSize: "1.8 MB",
      format: "PDF",
      timeframes: ["last-quarter", "this-year", "all-time"],
      highlight: { text: "+12% inflow", sentiment: "positive" },
      keywords: ["cashflow", "operations"],
    },
    {
      id: "investment-performance",
      title: "Investment Performance",
      type: "savings",
      typeLabel: "Savings",
      icon: "fa-chart-line",
      periodLabel: "September 2025",
      generatedOn: "2025-09-29",
      fileSize: "1.1 MB",
      format: "PDF",
      timeframes: ["this-month", "last-quarter", "this-year", "all-time"],
      highlight: { text: "Top fund +9.5%", sentiment: "positive" },
      keywords: ["investments", "portfolio"],
    },
    {
      id: "budget-variance",
      title: "Budget Variance Analysis",
      type: "expense",
      typeLabel: "Expense Analysis",
      icon: "fa-clipboard-check",
      periodLabel: "FY 2024-25",
      generatedOn: "2025-09-15",
      fileSize: "1.7 MB",
      format: "XLSX",
      timeframes: ["last-quarter", "this-year", "all-time"],
      highlight: { text: "3% under plan", sentiment: "positive" },
      keywords: ["variance", "forecast"],
    },
    {
      id: "year-end-tax",
      title: "Year-End Tax Planner",
      type: "tax",
      typeLabel: "Tax",
      icon: "fa-file-invoice-dollar",
      periodLabel: "Assessment Year 2025",
      generatedOn: "2025-09-10",
      fileSize: "2.0 MB",
      format: "PDF",
      timeframes: ["last-quarter", "this-year", "all-time"],
      highlight: { text: "New deductions added", sentiment: "neutral" },
      keywords: ["planner", "deductions"],
    },
  ];

  const metricsBase = {
    totalGenerated: 24,
    totalTrend: "+8 this month",
    averageSpending: 414400,
    averageTrend: "-4% vs last quarter",
    totalSavings: 3081600,
    savingsTrend: "+23% vs 2024",
  };

  const state = {
    type: "all",
    timeframe: "this-month",
    search: "",
  };

  const elements = {
    list: document.getElementById("reportList"),
    metrics: document.getElementById("reportMetrics"),
    search: document.getElementById("reportSearch"),
    typeFilter: document.getElementById("typeFilter"),
    timeFilter: document.getElementById("timeFilter"),
    generateBtn: document.getElementById("generateReportBtn"),
    dateRangeBtn: document.getElementById("dateRangeBtn"),
    customReportBtn: document.getElementById("customReportBtn"),
  };

  const reportMap = new Map();

  reports.forEach((report) => {
    report.generatedDate = new Date(`${report.generatedOn}T00:00:00`);
    report.searchText = [
      report.title,
      report.typeLabel,
      report.periodLabel,
      report.keywords.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    report.fileSizeLabel = report.fileSize;
    reportMap.set(report.id, report);
  });

  const debounce = (fn, delay = 200) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  const formatDate = (date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatCurrency = (value) => `₹${value.toLocaleString("en-IN")}`;

  const createToastHost = () => {
    let host = document.querySelector(".toast-stack");
    if (!host) {
      host = document.createElement("div");
      host.className = "toast-stack";
      document.body.appendChild(host);
    }
    return host;
  };

  const showToast = (message) => {
    const host = createToastHost();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    host.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => {
        toast.remove();
      }, 320);
    }, 2600);
  };

  const simulateBusyButton = (button, busyLabel, restoreLabel) => {
    if (!button) {
      return;
    }
    const original = restoreLabel ?? button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>${busyLabel}</span>`;
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = original;
    }, 1100);
  };

  const matchType = (report) =>
    state.type === "all" || report.type === state.type;
  const matchTimeframe = (report) =>
    state.timeframe === "all-time" ||
    report.timeframes.includes(state.timeframe);
  const matchSearch = (report) => {
    if (!state.search) {
      return true;
    }
    return report.searchText.includes(state.search.toLowerCase());
  };

  const filterReports = () =>
    reports.filter(
      (report) =>
        matchType(report) && matchTimeframe(report) && matchSearch(report)
    );

  const updateMetrics = (filtered) => {
    const totalCard = elements.metrics?.querySelector(
      '[data-metric="total-reports"]'
    );
    if (totalCard) {
      const valueEl = totalCard.querySelector(".metric-value");
      const trendEl = totalCard.querySelector(".metric-trend");
      valueEl.textContent = String(filtered.length).padStart(2, "0");
      const isFiltered =
        filtered.length !== reports.length ||
        !!state.search ||
        state.type !== "all" ||
        state.timeframe !== "this-month";
      trendEl.textContent = isFiltered
        ? `${filtered.length} of ${reports.length} in view`
        : metricsBase.totalTrend;
      trendEl.className = `metric-trend ${isFiltered ? "neutral" : "positive"}`;
    }

    const spendingCard = elements.metrics?.querySelector(
      '[data-metric="avg-spending"]'
    );
    if (spendingCard) {
      const valueEl = spendingCard.querySelector(".metric-value");
      const trendEl = spendingCard.querySelector(".metric-trend");
      valueEl.textContent = formatCurrency(metricsBase.averageSpending);
      const isNegative = metricsBase.averageTrend.includes("-");
      trendEl.textContent = metricsBase.averageTrend;
      trendEl.className = `metric-trend ${
        isNegative ? "negative" : "positive"
      }`;
    }

    const savingsCard = elements.metrics?.querySelector(
      '[data-metric="total-savings"]'
    );
    if (savingsCard) {
      const valueEl = savingsCard.querySelector(".metric-value");
      const trendEl = savingsCard.querySelector(".metric-trend");
      valueEl.textContent = formatCurrency(metricsBase.totalSavings);
      trendEl.textContent = metricsBase.savingsTrend;
      trendEl.className = "metric-trend positive";
    }
  };

  const buildReportCard = (report) => {
    const card = document.createElement("article");
    card.className = "report-card";

    const cardLeft = document.createElement("div");
    cardLeft.className = "card-left";

    const iconWrapper = document.createElement("div");
    iconWrapper.className = `icon-wrapper ${report.type}`;
    iconWrapper.innerHTML = `<i class="fas ${report.icon}"></i>`;

    const info = document.createElement("div");
    info.className = "report-info";

    const title = document.createElement("h3");
    title.textContent = report.title;

    const details = document.createElement("div");
    details.className = "report-details";

    const detailParts = [
      { kind: "text", value: report.periodLabel },
      { kind: "badge", value: report.typeLabel },
      { kind: "text", value: report.fileSizeLabel },
      { kind: "text", value: formatDate(report.generatedDate) },
    ];

    if (report.highlight?.text) {
      detailParts.push({
        kind: "trend",
        value: report.highlight.text,
        sentiment: report.highlight.sentiment ?? "neutral",
      });
    }

    detailParts.forEach((part, index) => {
      if (index > 0) {
        const divider = document.createElement("span");
        divider.className = "detail-divider";
        divider.textContent = "•";
        details.appendChild(divider);
      }

      if (part.kind === "badge") {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = part.value;
        details.appendChild(badge);
        return;
      }

      if (part.kind === "trend") {
        const trend = document.createElement("span");
        trend.className = `trend ${part.sentiment}`;
        trend.textContent = part.value;
        details.appendChild(trend);
        return;
      }

      const detail = document.createElement("span");
      detail.className = "detail-item";
      detail.textContent = part.value;
      details.appendChild(detail);
    });

    info.append(title, details);
    cardLeft.append(iconWrapper, info);

    const cardRight = document.createElement("div");
    cardRight.className = "report-actions";

    const formatBadge = document.createElement("span");
    formatBadge.className = "badge";
    formatBadge.textContent = report.format;

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "download-btn";
    downloadBtn.setAttribute("type", "button");
    downloadBtn.dataset.id = report.id;
    downloadBtn.innerHTML = `<i class="fas fa-download"></i><span>Download</span>`;

    cardRight.append(formatBadge, downloadBtn);

    card.append(cardLeft, cardRight);
    return card;
  };

  const renderList = (filtered) => {
    if (!elements.list) {
      return;
    }
    elements.list.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<i class="fas fa-folder-open"></i><p>No reports match the filters yet. Try adjusting the type, timeframe, or search query.</p>`;
      elements.list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const sorted = [...filtered].sort(
      (a, b) => b.generatedDate - a.generatedDate
    );
    sorted.forEach((report) => {
      fragment.appendChild(buildReportCard(report));
    });
    elements.list.appendChild(fragment);
  };

  const render = () => {
    const filtered = filterReports();
    updateMetrics(filtered);
    renderList(filtered);
  };

  elements.typeFilter?.addEventListener("change", (event) => {
    state.type = event.target.value;
    render();
  });

  elements.timeFilter?.addEventListener("change", (event) => {
    state.timeframe = event.target.value;
    render();
  });

  if (elements.search) {
    const handleSearch = debounce((value) => {
      state.search = value.trim();
      render();
    }, 180);
    elements.search.addEventListener("input", (event) =>
      handleSearch(event.target.value)
    );
  }

  elements.list?.addEventListener("click", (event) => {
    const button = event.target.closest(".download-btn");
    if (!button) {
      return;
    }
    const report = reportMap.get(button.dataset.id);
    if (!report) {
      return;
    }
    simulateBusyButton(button, "Preparing...");
    showToast(`Preparing ${report.title} (${report.format})`);
    setTimeout(() => {
      showToast(`${report.title} download started`);
    }, 1200);
  });

  elements.generateBtn?.addEventListener("click", () => {
    simulateBusyButton(
      elements.generateBtn,
      "Working...",
      `<i class="fas fa-file-circle-plus"></i><span>Generate New Report</span>`
    );
    showToast("Report generator will let you choose metrics soon.");
  });

  elements.customReportBtn?.addEventListener("click", () => {
    simulateBusyButton(
      elements.customReportBtn,
      "Opening...",
      `<i class="fas fa-wand-magic-sparkles"></i><span>Create Custom Report</span>`
    );
    showToast("Custom builder is on the roadmap. Stay tuned!");
  });

  elements.dateRangeBtn?.addEventListener("click", () => {
    showToast("Date range picker is coming in the next build.");
  });

  render();
});
