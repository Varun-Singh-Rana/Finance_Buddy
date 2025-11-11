const database = require("../../electron/db");
const transactionsStore = require("../../electron/models/transactions");

const dependencyError = database.dependencyError;

const state = {
  transactions: [],
  filtered: [],
  filters: {
    search: "",
    category: "",
    type: "",
  },
  isSaving: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  attachListeners();
  initialize();
});

function cacheElements() {
  elements.list = document.getElementById("transactionList");
  elements.search = document.getElementById("transactionSearch");
  elements.categoryFilter = document.getElementById(
    "transactionCategoryFilter"
  );
  elements.typeFilter = document.getElementById("transactionTypeFilter");
  elements.resetFilters = document.getElementById("transactionFilterReset");
  elements.addBtn = document.getElementById("transactionAddBtn");
  elements.modal = document.getElementById("transactionModal");
  elements.form = document.getElementById("transactionForm");
  elements.title = document.getElementById("transactionTitle");
  elements.category = document.getElementById("transactionCategory");
  elements.type = document.getElementById("transactionType");
  elements.amount = document.getElementById("transactionAmount");
  elements.date = document.getElementById("transactionDate");
  elements.notes = document.getElementById("transactionNotes");
  elements.status = document.getElementById("transactionStatus");
  elements.submitBtn = document.getElementById("transactionSubmitBtn");
  elements.submitLabel = document.getElementById("transactionSubmitLabel");
  elements.avatar = document.getElementById("transactionAvatar");
}

function attachListeners() {
  elements.search?.addEventListener("input", handleSearchChange);
  elements.categoryFilter?.addEventListener("change", handleCategoryChange);
  elements.typeFilter?.addEventListener("change", handleTypeChange);
  elements.resetFilters?.addEventListener("click", resetFilters);

  elements.addBtn?.addEventListener("click", openModal);

  document.querySelectorAll("[data-close-modal]").forEach((node) => {
    node.addEventListener("click", closeModal);
  });

  elements.modal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });

  elements.form?.addEventListener("submit", handleFormSubmit);

  elements.list?.addEventListener("click", handleListClick);
}

async function initialize() {
  setDefaultFormDate();

  if (dependencyError) {
    renderError(
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`
    );
    disableActions();
    return;
  }

  await loadAvatar();
  await loadTransactions();
}

function setDefaultFormDate() {
  if (!elements.date) {
    return;
  }
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  elements.date.value = `${yyyy}-${mm}-${dd}`;
}

async function loadAvatar() {
  if (!elements.avatar) {
    return;
  }

  try {
    const profile = await database.getUserProfile();
    if (profile?.full_name) {
      elements.avatar.textContent =
        profile.full_name.trim().charAt(0).toUpperCase() || "F";
    }
  } catch (error) {
    console.warn("Finlytics transactions: unable to load profile", error);
  }
}

function disableActions() {
  elements.addBtn?.setAttribute("disabled", "disabled");
  elements.search?.setAttribute("disabled", "disabled");
  elements.categoryFilter?.setAttribute("disabled", "disabled");
  elements.typeFilter?.setAttribute("disabled", "disabled");
  elements.resetFilters?.setAttribute("disabled", "disabled");
}

async function loadTransactions() {
  try {
    await transactionsStore.ensureTransactionTable();
    state.transactions = await transactionsStore.listTransactions();
    applyFilters();
    populateCategoryFilter();
  } catch (error) {
    console.error("Finlytics transactions: load failed", error);
    renderError(
      `Unable to load transactions: ${database.normalizeDbError(error)}`
    );
  }
}

function populateCategoryFilter() {
  if (!elements.categoryFilter) {
    return;
  }

  const categories = Array.from(
    new Set(state.transactions.map((item) => item.category).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const currentValue = elements.categoryFilter.value;
  elements.categoryFilter.innerHTML = "";

  const baseOption = document.createElement("option");
  baseOption.value = "";
  baseOption.textContent = "All Categories";
  elements.categoryFilter.appendChild(baseOption);

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.categoryFilter.appendChild(option);
  });

  if (categories.includes(currentValue)) {
    elements.categoryFilter.value = currentValue;
  } else {
    const hadSelection = Boolean(state.filters.category);
    state.filters.category = "";
    elements.categoryFilter.value = "";
    if (hadSelection) {
      applyFilters();
    }
  }
}

function applyFilters() {
  const searchTerm = state.filters.search.trim().toLowerCase();
  const category = state.filters.category;
  const type = state.filters.type;

  state.filtered = state.transactions.filter((transaction) => {
    const matchesSearch = !searchTerm
      ? true
      : [transaction.title, transaction.category, transaction.notes]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(searchTerm));

    const matchesCategory = category ? transaction.category === category : true;
    const matchesType = type ? transaction.type === type : true;

    return matchesSearch && matchesCategory && matchesType;
  });

  renderTransactions();
}

function renderTransactions() {
  if (!elements.list) {
    return;
  }

  elements.list.innerHTML = "";

  if (state.filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
			<i class="fas fa-inbox" style="font-size:2rem;margin-bottom:12px;display:block;"></i>
			<p>No transactions yet. Add your first one to get started.</p>
		`;
    elements.list.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filtered.forEach((transaction) => {
    fragment.appendChild(buildTransactionCard(transaction));
  });
  elements.list.appendChild(fragment);
}

function buildTransactionCard(transaction) {
  const card = document.createElement("article");
  card.className = `transaction-card ${transaction.type}`;
  card.dataset.id = transaction.id;

  const cardLeft = document.createElement("div");
  cardLeft.className = "card-left";

  const iconWrapper = document.createElement("div");
  iconWrapper.className = `icon-wrapper ${getIconClass(transaction)}`;
  iconWrapper.innerHTML = `<i class="${getIcon(transaction)}"></i>`;

  const info = document.createElement("div");
  info.className = "transaction-info";
  info.innerHTML = `
		<h3>${escapeHtml(transaction.title)}</h3>
		<div class="meta">
			<span class="badge">${escapeHtml(transaction.category)}</span>
			<span>${formatDate(transaction.occurredAt)}</span>
		</div>
	`;

  cardLeft.appendChild(iconWrapper);
  cardLeft.appendChild(info);

  const cardRight = document.createElement("div");
  cardRight.className = "card-right";

  const amount = document.createElement("span");
  const amountValue = formatCurrency(transaction.amount);
  const isExpense = transaction.type === "expense";
  amount.textContent = `${isExpense ? "-" : "+"}${amountValue}`;
  amount.className = `amount ${isExpense ? "negative" : "positive"}`;

  const trendIcon = document.createElement("i");
  trendIcon.className = `fas ${
    isExpense ? "fa-arrow-down" : "fa-arrow-up"
  } trend`;

  const actions = document.createElement("div");
  actions.className = "transaction-actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-button";
  deleteBtn.type = "button";
  deleteBtn.dataset.action = "delete";
  deleteBtn.dataset.id = transaction.id;
  deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';

  actions.appendChild(deleteBtn);

  cardRight.appendChild(amount);
  cardRight.appendChild(trendIcon);
  cardRight.appendChild(actions);

  card.appendChild(cardLeft);
  card.appendChild(cardRight);

  if (transaction.notes) {
    const notes = document.createElement("p");
    notes.className = "transaction-notes";
    notes.textContent = transaction.notes;
    card.appendChild(notes);
  }

  return card;
}

function getIconClass(transaction) {
  const map = {
    Food: "food",
    Transport: "transport",
    Entertainment: "entertainment",
    Income: "income",
  };
  return map[transaction.category] || "income";
}

function getIcon(transaction) {
  if (transaction.type === "income") {
    return "fas fa-sack-dollar";
  }

  if (transaction.type === "transfer") {
    return "fas fa-right-left";
  }

  const map = {
    Food: "fas fa-utensils",
    Transport: "fas fa-car-side",
    Entertainment: "fas fa-tv",
    Shopping: "fas fa-shopping-bag",
  };
  return map[transaction.category] || "fas fa-wallet";
}

function escapeHtml(value) {
  const str = String(value ?? "");
  return str.replace(/[&<>"']/g, (char) => {
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

function formatCurrency(value) {
  const currency = process.env.FINLYTICS_CURRENCY || "INR";
  const locale = process.env.FINLYTICS_LOCALE || "en-IN";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (_error) {
    return Number(value || 0).toFixed(2);
  }
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const locale = process.env.FINLYTICS_LOCALE || "en-IN";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function handleSearchChange(event) {
  state.filters.search = event.target.value || "";
  applyFilters();
}

function handleCategoryChange(event) {
  state.filters.category = event.target.value || "";
  applyFilters();
}

function handleTypeChange(event) {
  state.filters.type = event.target.value || "";
  applyFilters();
}

function resetFilters() {
  if (elements.search) {
    elements.search.value = "";
  }
  if (elements.categoryFilter) {
    elements.categoryFilter.value = "";
  }
  if (elements.typeFilter) {
    elements.typeFilter.value = "";
  }
  state.filters = { search: "", category: "", type: "" };
  applyFilters();
}

function openModal() {
  if (!elements.modal) {
    return;
  }
  elements.modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    elements.title?.focus();
  });
}

function closeModal() {
  if (!elements.modal) {
    return;
  }
  elements.modal.classList.add("hidden");
  elements.form?.reset();
  clearStatus();
  setDefaultFormDate();
}

async function handleFormSubmit(event) {
  event.preventDefault();

  if (state.isSaving) {
    return;
  }

  const payload = {
    title: elements.title?.value.trim() || "",
    category: elements.category?.value.trim() || "",
    type: elements.type?.value || "expense",
    amount: Number(elements.amount?.value || "0"),
    occurredAt: elements.date?.value,
    notes: elements.notes?.value || "",
  };

  const validationError = validatePayload(payload);
  if (validationError) {
    showStatus("error", validationError);
    return;
  }

  try {
    state.isSaving = true;
    setPending(true);
    clearStatus();
    const created = await transactionsStore.createTransaction(payload);
    if (created) {
      state.transactions = [created, ...state.transactions];
      applyFilters();
      populateCategoryFilter();
    } else {
      await loadTransactions();
    }
    showStatus("success", "Transaction saved");
    setTimeout(() => {
      closeModal();
    }, 600);
  } catch (error) {
    console.error("Finlytics transactions: save failed", error);
    showStatus(
      "error",
      `Unable to save transaction: ${database.normalizeDbError(error)}`
    );
  } finally {
    state.isSaving = false;
    setPending(false);
  }
}

function validatePayload(payload) {
  if (!payload.title) {
    return "Please provide a title.";
  }
  if (!payload.occurredAt) {
    return "Please select a date.";
  }
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    return "Enter an amount greater than zero.";
  }
  if (!payload.type) {
    return "Select a transaction type.";
  }
  return null;
}

function setPending(isPending) {
  if (!elements.submitBtn || !elements.submitLabel) {
    return;
  }
  elements.submitBtn.disabled = isPending;
  elements.submitBtn.setAttribute("aria-busy", String(isPending));
  elements.submitLabel.textContent = isPending
    ? "Saving..."
    : "Save Transaction";
}

function showStatus(kind, message) {
  if (!elements.status) {
    return;
  }
  elements.status.classList.remove("hidden", "error", "success");
  elements.status.classList.add(kind === "error" ? "error" : "success");
  elements.status.textContent = message;
}

function clearStatus() {
  if (!elements.status) {
    return;
  }
  elements.status.classList.add("hidden");
  elements.status.classList.remove("error", "success");
  elements.status.textContent = "";
}

function renderError(message) {
  if (!elements.list) {
    return;
  }
  elements.list.innerHTML = `
		<div class="empty-state">
			<i class="fas fa-triangle-exclamation" style="font-size:2rem;margin-bottom:12px;display:block;"></i>
			<p>${escapeHtml(message)}</p>
		</div>
	`;
}

async function handleListClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const id = Number(target.dataset.id);

  if (target.dataset.action === "delete" && Number.isFinite(id)) {
    const confirmed = window.confirm("Delete this transaction?");
    if (!confirmed) {
      return;
    }
    try {
      await transactionsStore.deleteTransaction(id);
      state.transactions = state.transactions.filter((row) => row.id !== id);
      applyFilters();
      populateCategoryFilter();
    } catch (error) {
      console.error("Finlytics transactions: delete failed", error);
      alert(`Unable to delete: ${database.normalizeDbError(error)}`);
    }
  }
}
