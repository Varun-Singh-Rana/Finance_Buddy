document.addEventListener("DOMContentLoaded", () => {
  const expenseCanvas = document.getElementById("expenseChart");
  if (expenseCanvas) {
    new Chart(expenseCanvas, {
      type: "pie",
      data: {
        labels: [
          "Rent",
          "Food",
          "Entertainment",
          "Transport",
          "Utilities",
          "Others",
        ],
        datasets: [
          {
            data: [42, 20, 10, 8, 7, 13],
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
        maintainAspectRatio: false, // key for fixed-height container
        layout: { padding: 0 },
        plugins: {
          legend: {
            position: "right",
            labels: { color: "#dce2f1", boxWidth: 10, font: { size: 11 } },
          },
        },
      },
    });
  }

  const spendingCanvas = document.getElementById("spendingChart");
  if (spendingCanvas) {
    new Chart(spendingCanvas, {
      type: "line",
      data: {
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"],
        datasets: [
          {
            label: "Actual Spending",
            data: [320000, 340000, 360000, 385000, 410000, 430000, 405000],
            borderColor: "#4c74ff",
            backgroundColor: "rgba(76, 116, 255, 0.18)",
            tension: 0.35,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: "Forecast",
            data: [330000, 345000, 365000, 390000, 420000, 438000, 415000],
            borderColor: "#1ec895",
            backgroundColor: "rgba(30, 200, 149, 0.2)",
            borderDash: [6, 6],
            tension: 0.35,
            fill: false,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        maintainAspectRatio: false, // key for fixed-height container
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
              callback: (v) => `₹${v.toLocaleString("en-IN")}`,
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
              label: (c) =>
                ` ${c.dataset.label}: ₹${c.parsed.y.toLocaleString("en-IN")}`,
            },
          },
        },
      },
    });
  }
});
