const fs = require("fs");
const path = require("path");

let dependencyError = null;
let sqlite3;
let Database;

try {
  sqlite3 = require("sqlite3");
  if (typeof sqlite3.verbose === "function") {
    sqlite3 = sqlite3.verbose();
  }
  ({ Database } = sqlite3);
} catch (error) {
  dependencyError = error;
}

let envLoaded = false;
let dbInstance = null;
let resolvedPath = null;

function loadEnv() {
  if (envLoaded) {
    return;
  }

  envLoaded = true;

  try {
    require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") {
      console.warn(
        "Finlytics database: unable to load .env file:",
        error.message
      );
    }
  }
}

loadEnv();

function getDatabase() {
  loadEnv();

  if (dependencyError) {
    throw dependencyError;
  }

  if (!Database) {
    throw new Error(
      "SQLite driver missing. Install dependencies with `npm install`."
    );
  }

  if (!dbInstance) {
    dbInstance = createDatabase();
  }

  return dbInstance;
}

function getPool() {
  return getDatabase();
}

function createDatabase() {
  const filePath = resolveDatabasePath();
  ensureDirectoryExists(filePath);

  const database = new Database(
    filePath,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    (error) => {
      if (error) {
        throw error;
      }
    }
  );

  database.query = (sql, params = []) => runQuery(database, sql, params);

  return database;
}

function resolveDatabasePath() {
  if (resolvedPath) {
    return resolvedPath;
  }

  const rawValue =
    process.env.FINLYTICS_DB_PATH ||
    process.env.FINLYTICS_DATABASE_URL ||
    process.env.DATABASE_URL;

  resolvedPath = normalizeDatabasePath(rawValue);
  return resolvedPath;
}

function normalizeDatabasePath(input) {
  const projectRoot = path.resolve(__dirname, "..", "");
  if (!input) {
    return path.resolve(projectRoot, "data/finlytics.sqlite");
  }

  let value = input.trim();

  if (/^sqlite:/i.test(value)) {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname ? `//${parsed.hostname}` : "";
      value = decodeURIComponent(`${host}${parsed.pathname || ""}`);
    } catch (_error) {
      value = value.replace(/^sqlite:/i, "");
    }
  }

  if (/^file:/i.test(value)) {
    value = value.replace(/^file:/i, "");
  }

  if (process.platform === "win32" && /^\/[a-zA-Z]:/.test(value)) {
    value = value.slice(1);
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(projectRoot, value);
}

function ensureDirectoryExists(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function runQuery(database, sql, inputParams) {
  const queryText = typeof sql === "string" ? sql : String(sql || "");
  const params = Array.isArray(inputParams)
    ? inputParams
    : inputParams === undefined
    ? []
    : [inputParams];
  const isSelect = /^\s*(select|with|pragma)\b/i.test(queryText);

  return new Promise((resolve, reject) => {
    if (isSelect) {
      database.all(queryText, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ rows });
      });
      return;
    }

    database.run(queryText, params, function runCallback(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ rows: [], lastID: this.lastID, changes: this.changes });
    });
  });
}

function query(sql, params) {
  const database = getDatabase();
  return runQuery(database, sql, params);
}

function closePool() {
  if (!dbInstance) {
    return Promise.resolve();
  }

  const closingDb = dbInstance;
  dbInstance = null;

  return new Promise((resolve, reject) => {
    closingDb.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function formatConnectionError(error) {
  const base = error?.message || "Unable to open SQLite database.";
  const target = resolveDatabasePath();
  return `${base} Verify FINLYTICS_DB_PATH or FINLYTICS_DATABASE_URL (current path: ${target}).`;
}

function normalizeDbError(error) {
  if (!error) {
    return "Unexpected error.";
  }

  const known = {
    SQLITE_CONSTRAINT:
      "Constraint failed. Check for duplicate or invalid data.",
    SQLITE_BUSY: "Database is busy. Please retry in a moment.",
    SQLITE_READONLY: "Database is read-only. Adjust file permissions.",
    SQLITE_ERROR: "Database query error. Review the SQL statement.",
  };

  if (error.code && known[error.code]) {
    return known[error.code];
  }

  return error.message || String(error);
}

async function ensureUserProfileTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      monthly_income REAL NOT NULL CHECK (monthly_income >= 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getUserProfile() {
  await ensureUserProfileTable();
  const result = await query(
    `SELECT id, full_name, date_of_birth, monthly_income, created_at
     FROM user_profile
     ORDER BY id
     LIMIT 1;`
  );
  return Array.isArray(result.rows) && result.rows.length > 0
    ? result.rows[0]
    : null;
}

async function saveUserProfile({ fullName, dateOfBirth, monthlyIncome }) {
  await ensureUserProfileTable();
  const trimmedName = (fullName || "").trim();
  await query("DELETE FROM user_profile;");
  await query(
    `INSERT INTO user_profile (full_name, date_of_birth, monthly_income)
     VALUES (?, ?, ?);`,
    [trimmedName, dateOfBirth, Number(monthlyIncome)]
  );
  return getUserProfile();
}

module.exports = {
  dependencyError,
  getDatabase,
  getPool,
  closePool,
  query,
  loadEnv,
  resolveDatabasePath,
  formatConnectionError,
  normalizeDbError,
  ensureUserProfileTable,
  getUserProfile,
  saveUserProfile,
};
