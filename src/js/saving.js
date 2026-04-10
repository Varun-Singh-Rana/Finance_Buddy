const database = require("../../electron/db");

const dependencyError = database.dependencyError;

const state = { plans: [] };
let editPlanId = null;

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
  metricSavedMonth: null,
  metricSavedLast: null,
  metricAverageProgress: null,
  metricSavedCaption: null,
  modal: null,
  addPlanBtn: null,
  sparkline: null,
};

let currencyFormatter;

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  currencyFormatter = createCurrencyFormatter();

  elements.form?.addEventListener("submit", handleSubmit);
  elements.list?.addEventListener("click", handlePlanListClick);

  elements.addPlanBtn?.addEventListener("click", () => {
    editPlanId = null;
    elements.form?.reset();
    const submit = elements.form?.querySelector("button[type='submit']");
    if (submit) submit.textContent = "Save Plan";
    openModal();
  });

  elements.modal?.addEventListener("click", (e) => {
    const target = e.target;
    if (
      target &&
      (target.dataset?.action === "close-modal" ||
        target.classList.contains("modal-close"))
    ) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  if (dependencyError) {
    showStatus(
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`,
      "error",
    );
    disableForm();
    return;
  }

  await loadProfile();
  await ensureSavingTable();
  try {
    await performMonthlyAllocations();
  } catch (err) {
    console.warn("performMonthlyAllocations failed on startup", err);
  }
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
  elements.metricSavedMonth = document.getElementById("metric-saved-month");
  elements.metricSavedLast = document.getElementById("metric-saved-last");
  elements.metricSavedTotal = document.getElementById("metric-saved-total");
  elements.allocation = document.getElementById("plan-allocation");
  elements.metricAverageProgress = document.getElementById(
    "metric-average-progress",
  );
  elements.metricSavedCaption = document.getElementById("metric-saved-caption");
  elements.modal = document.getElementById("saving-modal");
  elements.addPlanBtn = document.getElementById("add-plan-btn");
  elements.sparkline = document.getElementById("saving-sparkline");
}

function clearStatus() {
  if (!elements.status) return;
  elements.status.textContent = "";
  elements.status.classList.add("hidden");
  elements.status.classList.remove("info", "error", "success");
}

function formatDateForSql(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function updateMonthlySaved() {
  try {
    const now = new Date();
    const startWindow = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const endWindow = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const res = await database.query(
      `
      SELECT substr(occurred_at,1,7) as ym,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
      FROM "transaction"
      WHERE occurred_at >= ? AND occurred_at < ?
      GROUP BY ym
      ORDER BY ym ASC;
    `,
      [formatDateForSql(startWindow), formatDateForSql(endWindow)],
    );

    const rows = res.rows || [];
    const map = {};
    rows.forEach((r) => {
      map[r.ym] = Number(r.income) - Number(r.expense);
    });

    const months = [];
    for (let i = -5; i <= 0; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push(map[ym] || 0);
    }

    const thisMonth = months[months.length - 1] || 0;
    const lastMonth = months[months.length - 2] || 0;
    if (elements.metricSavedMonth)
      elements.metricSavedMonth.textContent =
        currencyFormatter.format(thisMonth);
    if (elements.metricSavedLast)
      elements.metricSavedLast.textContent =
        currencyFormatter.format(lastMonth);
    const total = months.reduce((s, v) => s + v, 0);
    if (elements.metricSavedTotal)
      elements.metricSavedTotal.textContent = currencyFormatter.format(total);
    drawSparkline(months);
  } catch (err) {
    console.warn("updateMonthlySaved error", err);
  }
}

function drawSparkline(values) {
  const svg = elements.sparkline;
  if (!svg) return;
  const width = Number(svg.getAttribute("width")) || 140;
  const height = Number(svg.getAttribute("height")) || 40;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (!values || !values.length) return;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pad = 6;
  const step = (width - pad * 2) / Math.max(1, values.length - 1);

  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const ns = "http://www.w3.org/2000/svg";
  const poly = document.createElementNS(ns, "polyline");
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", "var(--accent)");
  poly.setAttribute("stroke-width", "2");
  poly.setAttribute("points", points.join(" "));
  svg.appendChild(poly);

  const last = points[points.length - 1].split(",");
  const circle = document.createElementNS(ns, "circle");
  circle.setAttribute("cx", last[0]);
  circle.setAttribute("cy", last[1]);
  circle.setAttribute("r", "2.5");
  circle.setAttribute("fill", "var(--accent)");
  svg.appendChild(circle);
}

async function handlePlanListClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id || "");
  if (!Number.isFinite(id)) return;
  const plan = state.plans.find((p) => p.id === id);
  if (!plan) return;

  switch (action) {
    case "delete": {
      const confirmed = window.confirm(`Delete ${plan.title}?`);
      if (!confirmed) return;
      await deletePlan(id);
      break;
    }
    case "edit": {
      editPlanId = id;
      if (elements.title) elements.title.value = plan.title;
      if (elements.category) elements.category.value = plan.category;
      if (elements.target) elements.target.value = String(plan.target);
      if (elements.saved) elements.saved.value = String(plan.saved);
      if (elements.note) elements.note.value = plan.note || "";
      if (elements.allocation)
        elements.allocation.value = String(plan.allocation || 0);
      const submit = elements.form?.querySelector("button[type='submit']");
      if (submit) submit.textContent = "Save Changes";
      openModal();
      break;
    }
    default:
      break;
  }
}

async function updatePlan(id, payload) {
  try {
    await database.query(
      `UPDATE saving_plan SET title = ?, category = ?, target_amount = ?, saved_amount = ?, allocation_pct = ?, note = NULLIF(?, '') WHERE id = ?;`,
      [
        payload.title,
        payload.category,
        payload.target,
        payload.saved,
        payload.allocation || 0,
        payload.note || "",
        id,
      ],
    );
    editPlanId = null;
    if (elements.form) elements.form.reset();
    const submit = elements.form?.querySelector("button[type='submit']");
    if (submit) submit.textContent = "Save Plan";
    await refreshPlans();
    closeModal();
  } catch (err) {
    console.error("Finlytics savings: update failed", err);
    showStatus(
      `Unable to update plan: ${database.normalizeDbError(err)}`,
      "error",
    );
  }
}

async function deletePlan(id) {
  try {
    await database.query("DELETE FROM saving_plan WHERE id = ?;", [id]);
    await refreshPlans();
  } catch (err) {
    console.error("Finlytics savings: delete failed", err);
    showStatus(
      `Unable to delete plan: ${database.normalizeDbError(err)}`,
      "error",
    );
  }
}

function disableForm() {
  Array.from(elements.form?.elements || []).forEach((input) => {
    input.setAttribute("disabled", "disabled");
  });
  if (elements.addPlanBtn)
    elements.addPlanBtn.setAttribute("disabled", "disabled");
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
      allocation_pct REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await database.query(`
    CREATE TABLE IF NOT EXISTS allocation_log (
      month TEXT PRIMARY KEY,
      total REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS allocation_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      plan_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try {
    const info = await database.query("PRAGMA table_info(saving_plan);");
    const cols = info.rows || info || [];
    const hasAlloc = cols.some(
      (c) => c && (c.name === "allocation_pct" || c.name === "allocationPct"),
    );
    if (!hasAlloc) {
      await database.query(
        "ALTER TABLE saving_plan ADD COLUMN allocation_pct REAL DEFAULT 0;",
      );
    }
  } catch (__err) {
    console.warn(
      "Could not migrate saving_plan table to add allocation_pct column",
      __err,
    );
  }
}

async function performMonthlyAllocations() {
  try {
    const lastRes = await database.query(
      "SELECT MAX(month) AS last_month FROM allocation_log;",
    );
    const lastMonth =
      (lastRes.rows && lastRes.rows[0] && lastRes.rows[0].last_month) || null;

    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

    const monthsToProcess = [];
    const addOneMonth = (mStr) => {
      const [y, mo] = (mStr || "").split("-").map((v) => Number(v));
      if (!Number.isFinite(y) || !Number.isFinite(mo)) return null;
      const d = new Date(y, mo - 1 + 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };

    if (!lastMonth) {
      monthsToProcess.push(prevMonthStr);
    } else {
      let next = addOneMonth(lastMonth);
      while (next && next <= prevMonthStr) {
        monthsToProcess.push(next);
        next = addOneMonth(next);
      }
    }

    if (!monthsToProcess.length) return;

    for (const month of monthsToProcess) {
      const totals = await database.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
        FROM "transaction"
        WHERE substr(occurred_at,1,7) = ?;
      `,
        [month],
      );

      const row = (totals.rows && totals.rows[0]) || { income: 0, expense: 0 };
      const net = toNumber(row.income) - toNumber(row.expense);
      await database.query(
        "INSERT INTO allocation_log(month, total, created_at) VALUES(?, ?, ?);",
        [month, net, new Date().toISOString()],
      );

      if (net <= 0) {
        continue;
      }
      const plansRes = await database.query(
        "SELECT id, IFNULL(allocation_pct, 0) AS allocation_pct FROM saving_plan WHERE IFNULL(allocation_pct,0) > 0;",
      );
      const plans = plansRes.rows || [];

      for (const p of plans) {
        const pct = toNumber(p.allocation_pct);
        if (pct <= 0) continue;
        const amount = Number((net * (pct / 100)).toFixed(2));
        if (amount <= 0) continue;
        await database.query(
          "UPDATE saving_plan SET saved_amount = saved_amount + ? WHERE id = ?;",
          [amount, p.id],
        );
        await database.query(
          "INSERT INTO allocation_item(month, plan_id, amount, created_at) VALUES(?, ?, ?, ?);",
          [month, p.id, amount, new Date().toISOString()],
        );
      }

      showStatus(`Applied saving allocations for ${month}.`, "success");
    }
  } catch (err) {
    console.warn("performMonthlyAllocations error", err);
  }
}

async function refreshPlans() {
  try {
    const result = await database.query(
      `SELECT id, title, category, target_amount, saved_amount, IFNULL(allocation_pct, 0) AS allocation_pct, note, created_at
       FROM saving_plan
       ORDER BY created_at DESC, id DESC;`,
    );
    state.plans = (result.rows || []).map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category || "General",
      target: toNumber(row.target_amount),
      saved: toNumber(row.saved_amount),
      allocation: toNumber(row.allocation_pct),
      note: row.note || "",
      created: row.created_at,
    }));
    updateMetrics();
    renderPlans();
    showStatus(
      state.plans.length
        ? `Tracking ${state.plans.length} plan${state.plans.length === 1 ? "" : "s"}.`
        : "No saving plans yet. Add one above to get started.",
      state.plans.length ? "success" : "info",
    );
    setTimeout(() => clearStatus(), 3000);
    await updateMonthlySaved();
  } catch (error) {
    console.error("Finlytics savings: load failed", error);
    showStatus(
      `Unable to load saving plans: ${database.normalizeDbError(error)}`,
      "error",
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
    allocation: Math.max(
      0,
      Math.min(100, toNumber(elements.allocation?.value)),
    ),
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
    if (editPlanId) {
      await updatePlan(editPlanId, payload);
    } else {
      await database.query(
        `INSERT INTO saving_plan (title, category, target_amount, saved_amount, allocation_pct, note)
         VALUES (?, ?, ?, ?, ?, NULLIF(?, ''));`,
        [
          payload.title,
          payload.category,
          payload.target,
          payload.saved,
          payload.allocation || 0,
          payload.note,
        ],
      );

      elements.form?.reset();
      if (elements.saved) elements.saved.value = "0";
      await refreshPlans();
      closeModal();
    }
  } catch (error) {
    console.error("Finlytics savings: insert failed", error);
    showStatus(
      `Unable to save plan: ${database.normalizeDbError(error)}`,
      "error",
    );
  }
}

function renderPlans() {
  if (!elements.list) return;

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
        <article class="plan-card" data-id="${plan.id}" style="--plan-accent:${accent};">
          <header>
            <div>
              <p class="plan-meta">${escapeHtml(plan.category)}</p>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="plan-actions">
                <button type="button" class="plan-action" data-action="edit" data-id="${plan.id}" title="Edit plan"><i class="fas fa-pen" aria-hidden="true"></i></button>
                <button type="button" class="plan-action" data-action="delete" data-id="${plan.id}" title="Delete plan"><i class="fas fa-trash" aria-hidden="true"></i></button>
              </div>
              <span class="progress-pill">${percent}%</span>
            </div>
          </header>
          <div class="plan-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
            <div class="plan-track">
              <div class="plan-fill" style="width:${percent}%"></div>
            </div>
          </div>
          <div class="plan-stats">
            <span><strong>${currencyFormatter.format(plan.saved)}</strong> saved</span>
            <span>of ${currencyFormatter.format(plan.target)}</span>
          </div>
          ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ""}
          <footer class="plan-foot">
            <span><i class="fas fa-calendar-alt" aria-hidden="true"></i>${formatDate(plan.created)}</span>
            <span><i class="fas fa-coins" aria-hidden="true"></i>${remainingLabel}</span>
            <span><i class="fas fa-percent" aria-hidden="true"></i> ${plan.allocation}%</span>
          </footer>
        </article>
      `;
    })
    .join("");
}
function updateMetrics() {
  if (!currencyFormatter) return;

  const totals = state.plans.reduce(
    (acc, plan) => {
      acc.saved += plan.saved;
      acc.target += plan.target;
      acc.ratioSum += plan.target > 0 ? plan.saved / plan.target : 0;
      return acc;
    },
    { saved: 0, target: 0, ratioSum: 0 },
  );

  let weightedProgress = 0;
  if (totals.target > 0) {
    weightedProgress = Math.round(
      Math.min((totals.saved / totals.target) * 100, 100),
    );
  } else if (state.plans.length) {
    weightedProgress = Math.round(
      Math.min((totals.ratioSum / state.plans.length) * 100, 100),
    );
  }

  if (elements.metricPlanCount)
    elements.metricPlanCount.textContent = state.plans.length;
  if (elements.metricSavedAmount)
    elements.metricSavedAmount.textContent = currencyFormatter.format(
      totals.saved,
    );
  if (elements.metricSavedCaption)
    elements.metricSavedCaption.textContent = totals.target
      ? `of ${currencyFormatter.format(totals.target)} across goals`
      : "Across all plans";
  if (elements.metricAverageProgress)
    elements.metricAverageProgress.textContent = `${weightedProgress}%`;
}

function showStatus(message, variant = "info") {
  if (!elements.status) return;
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
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
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
  if (!key) return "var(--accent)";
  let score = 0;
  for (let i = 0; i < key.length; i += 1)
    score = (score + key.charCodeAt(i)) % palette.length;
  return palette[score];
}

function openModal() {
  if (!elements.modal) return;
  elements.modal.classList.remove("hidden");
  elements.modal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    const focusElem =
      elements.title || elements.form?.querySelector("input, textarea, button");
    if (focusElem) focusElem.focus();
  }, 40);
}

function closeModal() {
  if (!elements.modal) return;
  elements.modal.classList.add("hidden");
  elements.modal.setAttribute("aria-hidden", "true");
  if (elements.form) {
    elements.form.reset();
    const submit = elements.form.querySelector("button[type='submit']");
    if (submit) submit.textContent = "Save Plan";
  }
  editPlanId = null;
}

function getLocale() {
  if (process.env.FINLYTICS_LOCALE) return process.env.FINLYTICS_LOCALE;
  if (typeof navigator !== "undefined" && navigator.language)
    return navigator.language;
  return "en-IN";
}
