const incomeExpenseCtx = document.getElementById("incomeExpenseChart");
const categoryForecastCtx = document.getElementById("categoryForecastChart");
const categoryTableBody = document.getElementById("categoryTableBody");

const monthLabels = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];

const incomeData = [680000, 690000, 685000, 688000, 695000, 702000];
const forecastExpenseData = [400000, 402000, 404500, 408000, 410500, 413000];
const actualExpenseData = [398000, 401000, 400500, 402500, 406000, 408500];

const categoryData = [
  { name: "Rent", current: 144000, forecast: 144000 },
  { name: "Food", current: 68000, forecast: 62400 },
  { name: "Entertainment", current: 33600, forecast: 28000 },
  { name: "Transport", current: 25600, forecast: 27200 },
  { name: "Utilities", current: 22400, forecast: 23200 },
];

// Format numbers with currency symbol for display.
const formatCurrency = (value) => `₹${value.toLocaleString("en-IN")}`;

const buildIncomeExpenseChart = () => {
  if (!incomeExpenseCtx) {
    return;
  }

  // Chart shows actual vs forecasted expenses alongside income in single view.
  new Chart(incomeExpenseCtx, {
    type: "line",
    data: {
      labels: monthLabels,
      datasets: [
        {
          label: "Actual Expenses",
          data: actualExpenseData,
          borderColor: "#5c6bf5",
          backgroundColor: "rgba(92, 107, 245, 0.25)",
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: "#5c6bf5",
        },
        {
          label: "Forecasted Expenses",
          data: forecastExpenseData,
          borderColor: "#bc57ff",
          backgroundColor: "rgba(188, 87, 255, 0.25)",
          borderDash: [6, 4],
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: "#bc57ff",
        },
        {
          label: "Income",
          data: incomeData,
          borderColor: "#1ec895",
          backgroundColor: "rgba(30, 200, 149, 0.25)",
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: "#1ec895",
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
              return `${label} : ${formatCurrency(context.parsed.y)}`;
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
            callback: (value) => `₹${(value / 1000).toFixed(0)}k`,
          },
          grid: {
            color: "rgba(255, 255, 255, 0.03)",
          },
        },
      },
    },
  });
};

const buildCategoryForecastChart = () => {
  if (!categoryForecastCtx) {
    return;
  }

  const labels = categoryData.map((item) => item.name);
  const currentValues = categoryData.map((item) => item.current);
  const forecastValues = categoryData.map((item) => item.forecast);

  new Chart(categoryForecastCtx, {
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
              return `${label} : ${formatCurrency(context.parsed.y)}`;
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
            callback: (value) => `₹${(value / 1000).toFixed(0)}k`,
          },
          grid: {
            color: "rgba(255, 255, 255, 0.03)",
          },
        },
      },
    },
  });
};

const populateCategoryTable = () => {
  if (!categoryTableBody) {
    return;
  }

  categoryTableBody.innerHTML = "";

  categoryData.forEach((item) => {
    const change = item.forecast - item.current;
    const percent = change === 0 ? 0 : (change / item.current) * 100;
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = item.name;

    const rangeCell = document.createElement("td");
    rangeCell.innerHTML = `${formatCurrency(item.current)} → ${formatCurrency(
      item.forecast
    )} <span class="range-text">${percent.toFixed(1)}%</span>`;

    const pillCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.classList.add("trend-pill");
    pill.classList.add(change <= 0 ? "positive" : "negative");
    pill.innerHTML = `
			<i class="fas ${change <= 0 ? "fa-arrow-down" : "fa-arrow-up"}"></i>
			${Math.abs(percent).toFixed(1)}%
		`;
    pillCell.appendChild(pill);

    const deltaCell = document.createElement("td");
    deltaCell.classList.add("delta");
    deltaCell.classList.add(change <= 0 ? "positive" : "negative");
    deltaCell.textContent =
      change === 0
        ? "0"
        : `${change > 0 ? "+" : "-"}${formatCurrency(Math.abs(change))}`;

    row.appendChild(nameCell);
    row.appendChild(rangeCell);
    row.appendChild(pillCell);
    row.appendChild(deltaCell);
    categoryTableBody.appendChild(row);
  });
};

document.addEventListener("DOMContentLoaded", () => {
  buildIncomeExpenseChart();
  buildCategoryForecastChart();
  populateCategoryTable();
});
