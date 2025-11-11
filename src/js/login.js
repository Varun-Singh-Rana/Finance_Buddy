const database = require("../../electron/db");
const dependencyError = database.dependencyError;

const elements = {};
let connection = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  attachListeners();
  initialize();
});

function cacheElements() {
  elements.form = document.getElementById("userProfileForm");
  elements.fullName = document.getElementById("fullName");
  elements.dateOfBirth = document.getElementById("dateOfBirth");
  elements.monthlyIncome = document.getElementById("monthlyIncome");
  elements.status = document.getElementById("loginStatus");
  elements.submitButton = document.getElementById("loginSubmitBtn");
  elements.submitLabel = document.getElementById("loginSubmitLabel");
}

function attachListeners() {
  elements.form?.addEventListener("submit", handleSubmit);
}

async function initialize() {
  if (dependencyError) {
    showStatus(
      "error",
      dependencyError.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'sqlite3'. Run `npm install` and restart Finlytics."
        : `Unable to load SQLite driver: ${dependencyError.message}`
    );
    toggleForm(true);
    return;
  }

  try {
    connection = database.getPool();
    await ensureUserTable();
    const exists = await hasUserProfile();
    if (exists) {
      redirectToDashboard();
    }
  } catch (error) {
    console.error("Finlytics login: setup failed", error);
    showStatus(
      "error",
      `Unable to prepare login: ${database.normalizeDbError(error)}`
    );
    toggleForm(true);
  }
}

function toggleForm(disabled) {
  if (!elements.form) {
    return;
  }

  const controls = Array.from(elements.form.querySelectorAll("input, button"));
  controls.forEach((control) => {
    control.disabled = disabled;
  });
}

async function ensureUserTable() {
  if (!connection) {
    return;
  }

  await connection.query(`
		CREATE TABLE IF NOT EXISTS user_profile (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			full_name TEXT NOT NULL,
			date_of_birth TEXT NOT NULL,
			monthly_income REAL NOT NULL CHECK (monthly_income >= 0),
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		);
	`);
}

async function hasUserProfile() {
  if (!connection) {
    return false;
  }

  const result = await connection.query(
    "SELECT id FROM user_profile ORDER BY id LIMIT 1;"
  );
  return Array.isArray(result.rows) && result.rows.length > 0;
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!connection) {
    showStatus("error", "Database connection unavailable.");
    return;
  }

  const payload = {
    name: elements.fullName?.value.trim() || "",
    dob: elements.dateOfBirth?.value || "",
    income: Number(elements.monthlyIncome?.value || ""),
  };

  const validationError = validatePayload(payload);
  if (validationError) {
    showStatus("error", validationError);
    return;
  }

  setPending(true);
  showStatus("", "");

  try {
    await connection.query("DELETE FROM user_profile;");
    await connection.query(
      `INSERT INTO user_profile (full_name, date_of_birth, monthly_income)
			 VALUES (?, ?, ?);`,
      [payload.name, payload.dob, payload.income]
    );

    showStatus("success", "Profile saved! Redirecting to your dashboard...");
    setTimeout(redirectToDashboard, 900);
  } catch (error) {
    console.error("Finlytics login: save failed", error);
    showStatus(
      "error",
      `Could not save your details: ${database.normalizeDbError(error)}`
    );
  } finally {
    setPending(false);
  }
}

function validatePayload(payload) {
  if (!payload.name) {
    return "Please enter your name.";
  }

  if (!payload.dob) {
    return "Please select your date of birth.";
  }

  const parsedDOB = new Date(payload.dob);
  if (Number.isNaN(parsedDOB.getTime())) {
    return "Provide a valid date of birth.";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (parsedDOB > today) {
    return "Date of birth cannot be in the future.";
  }

  if (!Number.isFinite(payload.income) || payload.income <= 0) {
    return "Enter a monthly income greater than zero.";
  }

  return null;
}

function setPending(isPending) {
  if (!elements.submitButton) {
    return;
  }

  elements.submitButton.disabled = isPending;
  elements.submitButton.setAttribute("aria-busy", String(isPending));

  if (elements.submitLabel) {
    elements.submitLabel.textContent = isPending
      ? "Saving..."
      : "Continue to dashboard";
  }
}

function showStatus(type, message) {
  if (!elements.status) {
    return;
  }

  elements.status.classList.remove("hidden", "error", "success");

  if (!message) {
    elements.status.classList.add("hidden");
    elements.status.textContent = "";
    return;
  }

  elements.status.classList.add(type === "error" ? "error" : "success");
  elements.status.textContent = message;
}

function redirectToDashboard() {
  window.location.replace("dash.html");
}
