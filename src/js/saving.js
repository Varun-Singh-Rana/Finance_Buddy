const database = require("../../electron/db");

const dependencyError = database.dependencyError;

const state = {
  plans: [],
};

const elements = {
  form: null,
  status: null,
  list: null,
  title: null,
  category: null,
  target: null,
  saved: null,
  note: null,
  greeting: null,
  avatar: null,
  metricPlanCount: null,
  metricSavedAmount: null,
  metricAverageProgress: null,
  metricSavedCaption: null,
};

let currencyFormatter;

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  currencyFormatter = createCurrencyFormatter();

  elements.form?.addEventListener("submit", handleSubmit);

  if (dependencyError) {
    showStatus(
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`,
      "error"
    );
    disableForm();
    return;
  }

  await loadProfile();
  await ensureSavingTable();
  await refreshPlans();
});

function cacheElements() {
  elements.form = document.getElementById("saving-form");
  elements.status = document.getElementById("saving-status");
  elements.list = document.getElementById("plan-list");
  elements.title = document.getElementById("plan-title");
  elements.category = document.getElementById("plan-category");
  elements.target = document.getElementById("plan-target");
  elements.saved = document.getElementById("plan-saved");
  elements.note = document.getElementById("plan-note");
  elements.greeting = document.getElementById("saving-greeting");
  elements.avatar = document.getElementById("saving-avatar");
  elements.metricPlanCount = document.getElementById("metric-plan-count");
  elements.metricSavedAmount = document.getElementById("metric-saved-amount");
  elements.metricAverageProgress = document.getElementById(
    "metric-average-progress"
  );
  elements.metricSavedCaption = document.getElementById("metric-saved-caption");
}

function disableForm() {
  Array.from(elements.form?.elements || []).forEach((input) => {
    input.setAttribute("disabled", "disabled");
  });
}

async function loadProfile() {
  try {
    const profile = await database.getUserProfile();
    const name = profile?.full_name?.trim();
    if (name && elements.greeting) {
      elements.greeting.textContent = `Welcome back, ${name}`;
    }
    if (name && elements.avatar) {
      elements.avatar.textContent = name.charAt(0).toUpperCase() || "F";
    }
  } catch (error) {
    console.warn("Finlytics savings: unable to load user profile", error);
  }
}

async function ensureSavingTable() {
  await database.query(`
    CREATE TABLE IF NOT EXISTS saving_plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT,
      target_amount REAL NOT NULL CHECK (target_amount >= 0),
      saved_amount REAL NOT NULL CHECK (saved_amount >= 0),
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function refreshPlans() {
  try {
    const result = await database.query(
      `SELECT id, title, category, target_amount, saved_amount, note, created_at
       FROM saving_plan
       ORDER BY created_at DESC, id DESC;`
    );
    state.plans = (result.rows || []).map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category || "General",
      target: toNumber(row.target_amount),
      saved: toNumber(row.saved_amount),
      note: row.note || "",
      created: row.created_at,
    }));
    updateMetrics();
    renderPlans();
    showStatus(
      state.plans.length
        ? `Tracking ${state.plans.length} plan${
            state.plans.length === 1 ? "" : "s"
          }.`
        : "No saving plans yet. Add one above to get started.",
      state.plans.length ? "success" : "info"
    );
  } catch (error) {
    console.error("Finlytics savings: load failed", error);
    showStatus(
      `Unable to load saving plans: ${database.normalizeDbError(error)}`,
      "error"
    );
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const payload = {
    title: elements.title?.value.trim() || "",
    category: elements.category?.value.trim() || "General",
    target: toNumber(elements.target?.value),
    saved: toNumber(elements.saved?.value),
    note: elements.note?.value.trim() || null,
  };

  if (!payload.title) {
    showStatus("Give your plan a title.", "error");
    return;
  }

  if (payload.target <= 0) {
    showStatus("Target amount must be greater than zero.", "error");
    return;
  }

  try {
    await database.query(
      `INSERT INTO saving_plan (title, category, target_amount, saved_amount, note)
       VALUES (?, ?, ?, ?, NULLIF(?, ''));`,
      [
        payload.title,
        payload.category,
        payload.target,
        payload.saved,
        payload.note,
      ]
    );

    elements.form?.reset();
    if (elements.saved) {
      elements.saved.value = "0";
    }
    await refreshPlans();
  } catch (error) {
    console.error("Finlytics savings: insert failed", error);
    showStatus(
      `Unable to save plan: ${database.normalizeDbError(error)}`,
      "error"
    );
  }
}

function renderPlans() {
  if (!elements.list) {
    return;
  }

  if (!state.plans.length) {
    elements.list.innerHTML = `<p class="plan-meta">Add a plan to see it here.</p>`;
    return;
  }

  elements.list.innerHTML = state.plans
    .map((plan) => {
      const ratio = plan.target > 0 ? Math.min(plan.saved / plan.target, 1) : 0;
      const percent = Math.round(ratio * 100);
      const accent = getPlanAccent(plan);
      const remaining = Math.max(plan.target - plan.saved, 0);
      const remainingLabel =
        remaining > 0
          ? `Left ${currencyFormatter.format(remaining)}`
          : "Goal ready";
      return `
        <article class="plan-card" data-id="${
          plan.id
        }" style="--plan-accent:${accent};">
          <header>
            <div>
              <h3>${escapeHtml(plan.title)}</h3>
              <p class="plan-meta">${escapeHtml(plan.category)}</p>
            </div>
            <span class="progress-pill">${percent}%</span>
          </header>
          <div class="plan-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
            <div class="plan-track">
              <div class="plan-fill" style="width:${percent}%"></div>
            </div>
          </div>
          <div class="plan-stats">
            <span><strong>${currencyFormatter.format(
              plan.saved
            )}</strong> saved</span>
            <span>of ${currencyFormatter.format(plan.target)}</span>
          </div>
          ${
            plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ""
          }
          <footer class="plan-foot">
            <span><i class="fas fa-calendar-alt" aria-hidden="true"></i>${formatDate(
              plan.created
            )}</span>
            <span><i class="fas fa-coins" aria-hidden="true"></i>${remainingLabel}</span>
          </footer>
        </article>
      `;
    })
    .join("");
}

function updateMetrics() {
  if (!currencyFormatter) {
    return;
  }

  const totals = state.plans.reduce(
    (acc, plan) => {
      acc.saved += plan.saved;
      acc.target += plan.target;
      acc.ratioSum += plan.target > 0 ? plan.saved / plan.target : 0;
      return acc;
    },
    { saved: 0, target: 0, ratioSum: 0 }
  );

  let weightedProgress = 0;
  if (totals.target > 0) {
    weightedProgress = Math.round(
      Math.min((totals.saved / totals.target) * 100, 100)
    );
  } else if (state.plans.length) {
    weightedProgress = Math.round(
      Math.min((totals.ratioSum / state.plans.length) * 100, 100)
    );
  }

  if (elements.metricPlanCount) {
    elements.metricPlanCount.textContent = state.plans.length;
  }
  if (elements.metricSavedAmount) {
    elements.metricSavedAmount.textContent = currencyFormatter.format(
      totals.saved
    );
  }
  if (elements.metricSavedCaption) {
    elements.metricSavedCaption.textContent = totals.target
      ? `of ${currencyFormatter.format(totals.target)} across goals`
      : "Across all plans";
  }
  if (elements.metricAverageProgress) {
    elements.metricAverageProgress.textContent = `${weightedProgress}%`;
  }
}

function showStatus(message, variant = "info") {
  if (!elements.status) {
    return;
  }
  elements.status.textContent = message;
  elements.status.classList.remove("hidden", "info", "error", "success");
  elements.status.classList.add(variant);
}

function createCurrencyFormatter() {
  const locale = getLocale();
  const currency = process.env.FINLYTICS_CURRENCY || "INR";
  try {
    return new Intl.NumberFormat(locale, {
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

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
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

function formatDate(value) {
  if (!value) {
    return "just now";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  try {
    return new Intl.DateTimeFormat(getLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch (_error) {
    return date.toISOString().split("T")[0];
  }
}

function getPlanAccent(plan) {
  const palette = [
    "hsl(158, 82%, 60%)",
    "hsl(196, 85%, 65%)",
    "hsl(265, 80%, 67%)",
    "hsl(32, 90%, 67%)",
    "hsl(335, 74%, 68%)",
  ];
  const key = `${plan.category || ""}|${plan.title || ""}`.toLowerCase();
  if (!key) {
    return "var(--accent)";
  }
  let score = 0;
  for (let index = 0; index < key.length; index += 1) {
    score = (score + key.charCodeAt(index)) % palette.length;
  }
  return palette[score];
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
