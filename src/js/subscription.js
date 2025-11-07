const database = require("../../electron/db");
const dependencyError = database.dependencyError;

const locale = process.env.FINLYTICS_LOCALE || "en-IN";
const currencyCode = process.env.FINLYTICS_CURRENCY || "INR";

let currencyFormatter;
try {
  currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  });
} catch (error) {
  console.warn(
    "Finlytics subscriptions: falling back to USD currency format:",
    error.message
  );
  currencyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

let dateFormatter;
try {
  dateFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
} catch (error) {
  console.warn(
    "Finlytics subscriptions: falling back to default date format:",
    error.message
  );
  dateFormatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const dueSoonThreshold = (() => {
  const value = Number.parseInt(process.env.FINLYTICS_DUE_SOON_DAYS || "5", 10);
  return Number.isFinite(value) && value > 0 ? value : 5;
})();

const CATEGORY_META = {
  Entertainment: {
    icon: "fas fa-clapperboard",
    gradient: "linear-gradient(135deg, #ff7a7a, #ff5858)",
  },
  Music: {
    icon: "fas fa-music",
    gradient: "linear-gradient(135deg, #59d1ff, #2aa7ff)",
  },
  Shopping: {
    icon: "fas fa-shopping-bag",
    gradient: "linear-gradient(135deg, #f6ad55, #f97316)",
  },
  Productivity: {
    icon: "fas fa-bolt",
    gradient: "linear-gradient(135deg, #a855f7, #7c3aed)",
  },
  Development: {
    icon: "fas fa-code",
    gradient: "linear-gradient(135deg, #60a5fa, #2563eb)",
  },
  Design: {
    icon: "fas fa-pencil-ruler",
    gradient: "linear-gradient(135deg, #f472b6, #ec4899)",
  },
  Education: {
    icon: "fas fa-graduation-cap",
    gradient: "linear-gradient(135deg, #34d399, #059669)",
  },
  Finance: {
    icon: "fas fa-wallet",
    gradient: "linear-gradient(135deg, #38bdf8, #0ea5e9)",
  },
  Utility: {
    icon: "fas fa-plug",
    gradient: "linear-gradient(135deg, #facc15, #f59e0b)",
  },
  Health: {
    icon: "fas fa-heartbeat",
    gradient: "linear-gradient(135deg, #f97316, #fb7185)",
  },
  Travel: {
    icon: "fas fa-plane",
    gradient: "linear-gradient(135deg, #38bdf8, #2563eb)",
  },
  Gaming: {
    icon: "fas fa-gamepad",
    gradient: "linear-gradient(135deg, #c084fc, #8b5cf6)",
  },
  Cloud: {
    icon: "fas fa-cloud",
    gradient: "linear-gradient(135deg, #38bdf8, #0ea5e9)",
  },
  Other: {
    icon: "fas fa-circle-notch",
    gradient: "linear-gradient(135deg, #7c86a1, #4b5563)",
  },
};

const DEFAULT_CATEGORY_ORDER = [
  "Entertainment",
  "Music",
  "Shopping",
  "Productivity",
  "Development",
  "Design",
  "Education",
  "Finance",
  "Utility",
  "Health",
  "Travel",
  "Gaming",
  "Cloud",
  "Other",
];

const BILLING_CYCLES = {
  Weekly: {
    label: "Weekly",
    toMonthly: (amount) => toNumber(amount) * (52 / 12),
    toAnnual: (amount) => toNumber(amount) * 52,
  },
  Monthly: {
    label: "Monthly",
    toMonthly: (amount) => toNumber(amount),
    toAnnual: (amount) => toNumber(amount) * 12,
  },
  Quarterly: {
    label: "Quarterly",
    toMonthly: (amount) => toNumber(amount) / 3,
    toAnnual: (amount) => toNumber(amount) * 4,
  },
  Semiannual: {
    label: "Semiannual",
    toMonthly: (amount) => toNumber(amount) / 6,
    toAnnual: (amount) => toNumber(amount) * 2,
  },
  Yearly: {
    label: "Yearly",
    toMonthly: (amount) => toNumber(amount) / 12,
    toAnnual: (amount) => toNumber(amount),
  },
};

const MILLISECONDS_IN_DAY = 86_400_000;

const state = {
  subscriptions: [],
  filtered: [],
  loading: false,
  dbReady: false,
};

const elements = {};

let pool = null;
let toastTimer = null;
let modalOpen = false;

window.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  attachListeners();
  syncCategoryOptions(DEFAULT_CATEGORY_ORDER);

  if (dependencyError) {
    const message =
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'pg'. Run `npm install` inside the project folder and restart Finlytics."
        : `Unable to load PostgreSQL driver: ${dependencyError.message}`;
    showStatus("error", message);
    toggleAddButtons(true);
    return;
  }

  initDatabase();
});

window.addEventListener("beforeunload", () => {
  database.closePool().catch(() => {});
});

function cacheElements() {
  elements.totalMonthlyCost = document.getElementById("totalMonthlyCost");
  elements.activeSubscriptions = document.getElementById("activeSubscriptions");
  elements.annualCost = document.getElementById("annualCost");
  elements.searchInput = document.getElementById("subscriptionSearch");
  elements.categoryFilter = document.getElementById("categoryFilter");
  elements.sortSelect = document.getElementById("sortBy");
  elements.subscriptionList = document.getElementById("subscriptionList");
  elements.subscriptionStatus = document.getElementById("subscriptionStatus");
  elements.subscriptionLoading = document.getElementById("subscriptionLoading");
  elements.subscriptionEmptyState = document.getElementById(
    "subscriptionEmptyState"
  );
  elements.emptyStateAddBtn = document.getElementById("emptyStateAddBtn");
  elements.addSubscriptionBtn = document.getElementById("addSubscriptionBtn");
  elements.modalBackdrop = document.getElementById("subscriptionModal");
  elements.modal = elements.modalBackdrop
    ? elements.modalBackdrop.querySelector(".modal")
    : null;
  elements.closeModalBtn = document.getElementById("closeModalBtn");
  elements.cancelModalBtn = document.getElementById("cancelModalBtn");
  elements.subscriptionForm = document.getElementById("subscriptionForm");
  elements.nameInput = document.getElementById("subscriptionName");
  elements.categorySelect = document.getElementById("subscriptionCategory");
  elements.amountInput = document.getElementById("subscriptionAmount");
  elements.billingCycleSelect = document.getElementById(
    "subscriptionBillingCycle"
  );
  elements.nextBillingInput = document.getElementById(
    "subscriptionNextBilling"
  );
  elements.notesInput = document.getElementById("subscriptionNotes");
  elements.saveButton = document.getElementById("saveSubscriptionBtn");
  elements.saveButtonLabel = elements.saveButton
    ? elements.saveButton.querySelector("span")
    : null;
  elements.toast = document.getElementById("subscriptionToast");
}

function attachListeners() {
  elements.addSubscriptionBtn?.addEventListener("click", () => openModal());
  elements.emptyStateAddBtn?.addEventListener("click", () => openModal());
  elements.closeModalBtn?.addEventListener("click", () => closeModal());
  elements.cancelModalBtn?.addEventListener("click", () => closeModal());

  elements.modalBackdrop?.addEventListener("mousedown", (event) => {
    if (event.target === elements.modalBackdrop) {
      closeModal();
    }
  });

  elements.subscriptionForm?.addEventListener("submit", handleFormSubmit);

  elements.searchInput?.addEventListener("input", () => applyFilters());
  elements.categoryFilter?.addEventListener("change", () => applyFilters());
  elements.sortSelect?.addEventListener("change", () => applyFilters());

  elements.subscriptionList?.addEventListener("click", handleListClick);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalOpen) {
      closeModal();
    }
  });
}

function toggleAddButtons(disabled) {
  if (elements.addSubscriptionBtn) {
    elements.addSubscriptionBtn.disabled = disabled;
  }
  if (elements.emptyStateAddBtn) {
    elements.emptyStateAddBtn.disabled = disabled;
  }
}

async function initDatabase() {
  if (dependencyError) {
    toggleAddButtons(true);
    setLoading(false);
    return;
  }

  try {
    pool = database.getPool();
  } catch (error) {
    showStatus("error", database.formatConnectionError(error));
    toggleAddButtons(true);
    setLoading(false);
    return;
  }

  pool.on("error", (error) => {
    console.error("Finlytics subscriptions: database error", error);
    showStatus("error", "Database connection lost. Please restart the app.");
  });

  try {
    await pool.query(`
			CREATE TABLE IF NOT EXISTS subscriptions (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				category TEXT NOT NULL,
				amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
				billing_cycle TEXT NOT NULL,
				next_billing_date DATE NOT NULL,
				notes TEXT,
				created_at TIMESTAMPTZ DEFAULT NOW()
			);
		`);
    state.dbReady = true;
    toggleAddButtons(false);
    resetForm();
    await loadSubscriptions();
  } catch (error) {
    console.error("Finlytics subscriptions: setup failed", error);
    showStatus(
      "error",
      `Database setup failed: ${database.normalizeDbError(error)}`
    );
    toggleAddButtons(true);
    setLoading(false);
  }
}

async function loadSubscriptions() {
  if (!state.dbReady || !pool) {
    return;
  }

  setLoading(true);
  try {
    const result = await pool.query(`
			SELECT
				id,
				name,
				category,
				amount::float8 AS amount,
				billing_cycle,
				next_billing_date,
				notes
			FROM subscriptions
			ORDER BY next_billing_date ASC NULLS LAST, name ASC;
		`);

    state.subscriptions = result.rows.map(normalizeRow);

    const extraCategories = Array.from(
      new Set(
        state.subscriptions
          .map((item) => item.category)
          .filter((category) => !DEFAULT_CATEGORY_ORDER.includes(category))
      )
    ).sort((a, b) => a.localeCompare(b));

    syncCategoryOptions([...DEFAULT_CATEGORY_ORDER, ...extraCategories]);

    applyFilters();
    clearStatus();
  } catch (error) {
    console.error("Finlytics subscriptions: load failed", error);
    showStatus(
      "error",
      `Unable to load subscriptions: ${database.normalizeDbError(error)}`
    );
  } finally {
    setLoading(false);
  }
}

function applyFilters() {
  if (!state.dbReady) {
    return;
  }

  const searchValue = elements.searchInput?.value.trim().toLowerCase() || "";
  const categoryValue = elements.categoryFilter?.value || "all";
  const sortValue = elements.sortSelect?.value || "next_billing";

  const filtered = state.subscriptions.filter((subscription) => {
    const matchesCategory =
      categoryValue === "all" || subscription.category === categoryValue;
    const matchesSearch = !searchValue
      ? true
      : subscription.name.toLowerCase().includes(searchValue) ||
        (subscription.notes &&
          subscription.notes.toLowerCase().includes(searchValue));
    return matchesCategory && matchesSearch;
  });

  filtered.sort(getComparator(sortValue));

  state.filtered = filtered;
  renderSubscriptions(filtered);
  updateSummary(filtered);
}

function renderSubscriptions(subscriptions) {
  if (!elements.subscriptionList || !elements.subscriptionEmptyState) {
    return;
  }

  elements.subscriptionList.innerHTML = "";

  if (!subscriptions.length) {
    elements.subscriptionList.classList.add("hidden");
    if (!state.loading) {
      elements.subscriptionEmptyState.classList.remove("hidden");
    }
    return;
  }

  elements.subscriptionEmptyState.classList.add("hidden");
  elements.subscriptionList.classList.remove("hidden");

  const fragment = document.createDocumentFragment();
  subscriptions.forEach((subscription) => {
    fragment.appendChild(buildSubscriptionCard(subscription));
  });
  elements.subscriptionList.appendChild(fragment);
}

function buildSubscriptionCard(subscription) {
  const card = document.createElement("article");
  card.className = "subscription-card";
  card.dataset.id = String(subscription.id);

  const meta = getCategoryMeta(subscription.category);
  const daysUntil = computeDaysUntil(subscription.nextBilling);

  if (
    typeof daysUntil === "number" &&
    daysUntil <= dueSoonThreshold &&
    daysUntil >= 0
  ) {
    card.classList.add("due-soon");
  }

  const left = document.createElement("div");
  left.className = "card-left";

  const iconWrapper = document.createElement("div");
  iconWrapper.className = "icon-avatar";
  iconWrapper.style.background = meta.gradient;

  const icon = document.createElement("i");
  icon.className = meta.icon;
  iconWrapper.appendChild(icon);

  const info = document.createElement("div");
  info.className = "card-info";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = subscription.name;

  const tags = document.createElement("div");
  tags.className = "card-tags";

  const category = document.createElement("span");
  category.className = "category-badge";
  category.textContent = subscription.category;
  tags.appendChild(category);

  if (typeof daysUntil === "number") {
    const chip = document.createElement("span");
    if (daysUntil < 0) {
      chip.className = "overdue-chip";
      chip.textContent = `Overdue by ${Math.abs(daysUntil)} day${
        Math.abs(daysUntil) === 1 ? "" : "s"
      }`;
    } else if (daysUntil === 0) {
      chip.className = "upcoming-chip";
      chip.textContent = "Due today";
    } else if (daysUntil <= dueSoonThreshold) {
      chip.className = "upcoming-chip";
      chip.textContent = `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
    }

    if (chip.textContent) {
      tags.appendChild(chip);
    }
  }

  info.appendChild(title);
  info.appendChild(tags);

  if (subscription.notes) {
    const notes = document.createElement("p");
    notes.className = "card-notes";
    notes.textContent = subscription.notes;
    info.appendChild(notes);
  }

  left.appendChild(iconWrapper);
  left.appendChild(info);

  const right = document.createElement("div");
  right.className = "card-right";

  const amountStat = createStat(
    "Amount",
    formatCurrency(subscription.amount),
    `${subscription.billingCycle} plan`
  );

  const nextBillingLabel = formatDisplayDate(subscription.nextBilling);
  let nextBillingHint = "";
  if (typeof daysUntil === "number") {
    if (daysUntil < 0) {
      nextBillingHint = `Overdue by ${Math.abs(daysUntil)} day${
        Math.abs(daysUntil) === 1 ? "" : "s"
      }`;
    } else if (daysUntil === 0) {
      nextBillingHint = "Renewing today";
    } else {
      nextBillingHint = `Renews in ${daysUntil} day${
        daysUntil === 1 ? "" : "s"
      }`;
    }
  }

  const nextBillingStat = createStat(
    "Next Billing",
    nextBillingLabel,
    nextBillingHint
  );

  const annualSpend = convertToAnnual(
    subscription.amount,
    subscription.billingCycle
  );
  const monthlyAvg = convertToMonthly(
    subscription.amount,
    subscription.billingCycle
  );
  const annualStat = createStat(
    "Annual Spend",
    formatCurrency(annualSpend),
    `${formatCurrency(monthlyAvg)} monthly avg`
  );

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "icon-button delete-btn";
  deleteButton.dataset.action = "delete";
  deleteButton.dataset.id = String(subscription.id);
  deleteButton.title = "Delete subscription";

  const deleteIcon = document.createElement("i");
  deleteIcon.className = "fas fa-trash";
  deleteButton.appendChild(deleteIcon);

  right.appendChild(amountStat);
  right.appendChild(nextBillingStat);
  right.appendChild(annualStat);
  right.appendChild(deleteButton);

  card.appendChild(left);
  card.appendChild(right);

  return card;
}

function createStat(label, value, hint) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-stat";

  const labelNode = document.createElement("span");
  labelNode.className = "stat-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("span");
  valueNode.className = "stat-value";
  valueNode.textContent = value;

  wrapper.appendChild(labelNode);
  wrapper.appendChild(valueNode);

  if (hint) {
    const hintNode = document.createElement("span");
    hintNode.className = "stat-hint";
    hintNode.textContent = hint;
    wrapper.appendChild(hintNode);
  }

  return wrapper;
}

function updateSummary(subscriptions) {
  if (
    !elements.totalMonthlyCost ||
    !elements.activeSubscriptions ||
    !elements.annualCost
  ) {
    return;
  }

  const totals = subscriptions.reduce(
    (accumulator, subscription) => {
      accumulator.monthly += convertToMonthly(
        subscription.amount,
        subscription.billingCycle
      );
      accumulator.annual += convertToAnnual(
        subscription.amount,
        subscription.billingCycle
      );
      return accumulator;
    },
    { monthly: 0, annual: 0 }
  );

  elements.totalMonthlyCost.textContent = formatCurrency(totals.monthly);
  elements.activeSubscriptions.textContent = String(subscriptions.length);
  elements.annualCost.textContent = formatCurrency(totals.annual);
}

function handleFormSubmit(event) {
  event.preventDefault();

  if (!state.dbReady || !pool) {
    showStatus(
      "error",
      "Configure the PostgreSQL connection before adding subscriptions."
    );
    return;
  }

  if (!elements.subscriptionForm) {
    return;
  }

  const data = new FormData(elements.subscriptionForm);
  const payload = {
    name: (data.get("name") || "").toString().trim(),
    category: (data.get("category") || "Other").toString(),
    amount: Number(data.get("amount")),
    billingCycle: (data.get("billingCycle") || "Monthly").toString(),
    nextBilling: (data.get("nextBilling") || "").toString(),
    notes: (data.get("notes") || "").toString().trim(),
  };

  const validationError = validatePayload(payload);
  if (validationError) {
    showStatus("error", validationError);
    return;
  }

  saveSubscription(payload);
}

async function saveSubscription(payload) {
  if (!pool) {
    return;
  }

  setFormPending(true);

  try {
    await pool.query(
      `INSERT INTO subscriptions
				(name, category, amount, billing_cycle, next_billing_date, notes)
			VALUES
				($1, $2, $3, $4, $5, NULLIF($6, ''));
		`,
      [
        payload.name,
        payload.category,
        payload.amount,
        payload.billingCycle,
        payload.nextBilling,
        payload.notes,
      ]
    );

    closeModal();
    showToast(`${payload.name} added`);
    await loadSubscriptions();
  } catch (error) {
    console.error("Finlytics subscriptions: save failed", error);
    showStatus(
      "error",
      `Failed to save subscription: ${database.normalizeDbError(error)}`
    );
  } finally {
    setFormPending(false);
  }
}

function handleListClick(event) {
  const target = event.target.closest("[data-action='delete']");
  if (!target) {
    return;
  }

  const id = Number.parseInt(target.dataset.id || "", 10);
  if (!Number.isFinite(id)) {
    return;
  }

  const subscription = state.subscriptions.find((item) => item.id === id);
  if (!subscription) {
    return;
  }

  const confirmed = window.confirm(
    `Delete ${subscription.name}? This action cannot be undone.`
  );

  if (!confirmed) {
    return;
  }

  deleteSubscription(id, subscription.name);
}

async function deleteSubscription(id, name) {
  if (!pool) {
    return;
  }

  setLoading(true);
  try {
    await pool.query("DELETE FROM subscriptions WHERE id = $1;", [id]);
    showToast(`${name} removed`);
    await loadSubscriptions();
  } catch (error) {
    console.error("Finlytics subscriptions: delete failed", error);
    showStatus(
      "error",
      `Could not delete subscription: ${database.normalizeDbError(error)}`
    );
  } finally {
    setLoading(false);
  }
}

function openModal() {
  if (!elements.modalBackdrop) {
    return;
  }

  clearStatus();
  resetForm();
  elements.modalBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  modalOpen = true;
  elements.nameInput?.focus();
}

function closeModal() {
  if (!elements.modalBackdrop) {
    return;
  }

  elements.modalBackdrop.classList.add("hidden");
  document.body.style.removeProperty("overflow");
  modalOpen = false;
}

function resetForm() {
  if (!elements.subscriptionForm) {
    return;
  }

  elements.subscriptionForm.reset();

  if (elements.categorySelect) {
    elements.categorySelect.value = DEFAULT_CATEGORY_ORDER[0] || "Other";
  }
  if (elements.billingCycleSelect) {
    elements.billingCycleSelect.value = "Monthly";
  }
  if (elements.nextBillingInput) {
    elements.nextBillingInput.value = formatDateForInput(
      nextBillingDefaultDate()
    );
  }
}

function nextBillingDefaultDate() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
}

function setFormPending(isPending) {
  if (!elements.saveButton) {
    return;
  }

  elements.saveButton.disabled = isPending;
  elements.saveButton.setAttribute("aria-busy", String(isPending));

  if (elements.saveButtonLabel) {
    elements.saveButtonLabel.textContent = isPending
      ? "Saving..."
      : "Save Subscription";
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;

  if (elements.subscriptionLoading) {
    elements.subscriptionLoading.classList.toggle("hidden", !isLoading);
  }

  if (isLoading && elements.subscriptionEmptyState) {
    elements.subscriptionEmptyState.classList.add("hidden");
  }

  if (isLoading && elements.subscriptionList) {
    elements.subscriptionList.classList.add("hidden");
  }
}

function showStatus(type, message) {
  if (!elements.subscriptionStatus) {
    return;
  }

  elements.subscriptionStatus.textContent = message;
  elements.subscriptionStatus.classList.remove("hidden");
  elements.subscriptionStatus.classList.toggle("error", type === "error");
}

function clearStatus() {
  if (!elements.subscriptionStatus) {
    return;
  }

  elements.subscriptionStatus.textContent = "";
  elements.subscriptionStatus.classList.add("hidden");
  elements.subscriptionStatus.classList.remove("error");
}

function showToast(message, variant = "success") {
  if (!elements.toast) {
    return;
  }

  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  elements.toast.classList.toggle("error", variant === "error");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    elements.toast?.classList.add("hidden");
    elements.toast?.classList.remove("error");
  }, 3400);
}

function syncCategoryOptions(categories) {
  if (elements.categorySelect) {
    const current = elements.categorySelect.value;
    elements.categorySelect.innerHTML = "";
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      elements.categorySelect.appendChild(option);
    });
    if (categories.includes(current)) {
      elements.categorySelect.value = current;
    }
  }

  if (elements.categoryFilter) {
    const currentFilter = elements.categoryFilter.value;
    elements.categoryFilter.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Categories";
    elements.categoryFilter.appendChild(allOption);

    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      elements.categoryFilter.appendChild(option);
    });

    if (categories.includes(currentFilter)) {
      elements.categoryFilter.value = currentFilter;
    } else {
      elements.categoryFilter.value = "all";
    }
  }
}

function normalizeRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || "Other",
    amount: toNumber(row.amount),
    billingCycle: row.billing_cycle || "Monthly",
    nextBilling: parseDateOnly(row.next_billing_date),
    notes: row.notes || "",
  };
}

function validatePayload(payload) {
  if (!payload.name) {
    return "Subscription name is required.";
  }

  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    return "Enter a valid amount greater than zero.";
  }

  if (!BILLING_CYCLES[payload.billingCycle]) {
    return "Select a supported billing cycle.";
  }

  if (!payload.nextBilling) {
    return "Next billing date is required.";
  }

  if (!parseDateOnly(payload.nextBilling)) {
    return "Provide a valid next billing date.";
  }

  return null;
}

function convertToMonthly(amount, billingCycle) {
  const cycle = BILLING_CYCLES[billingCycle] || BILLING_CYCLES.Monthly;
  return roundCurrency(cycle.toMonthly(amount));
}

function convertToAnnual(amount, billingCycle) {
  const cycle = BILLING_CYCLES[billingCycle] || BILLING_CYCLES.Monthly;
  return roundCurrency(cycle.toAnnual(amount));
}

function formatCurrency(value) {
  return currencyFormatter.format(roundCurrency(value));
}

function roundCurrency(value) {
  const numeric = toNumber(value);
  return Math.round(numeric * 100) / 100;
}

function getCategoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.Other;
}

function computeDaysUntil(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = target.getTime() - today.getTime();

  return Math.round(difference / MILLISECONDS_IN_DAY);
}

function formatDisplayDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "Not scheduled";
  }
  return dateFormatter.format(date);
}

function formatDateForInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const parts = value.toString().split("-");
  if (parts.length < 3) {
    return null;
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }

  return new Date(year, month, day);
}

function getComparator(key) {
  switch (key) {
    case "amount_desc":
      return (a, b) => b.amount - a.amount;
    case "amount_asc":
      return (a, b) => a.amount - b.amount;
    case "name":
      return (a, b) => a.name.localeCompare(b.name);
    case "next_billing":
    default:
      return (a, b) => {
        const aTime = a.nextBilling
          ? a.nextBilling.getTime()
          : Number.POSITIVE_INFINITY;
        const bTime = b.nextBilling
          ? b.nextBilling.getTime()
          : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      };
  }
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
