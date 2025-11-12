const fs = require("fs");
const path = require("path");
const os = require("os");

let electronApp = null;

try {
  ({ app: electronApp } = require("electron"));
} catch (_error) {
  electronApp = null;
}

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
  ensureFileWritable(filePath);

  const database = new Database(
    filePath,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    (error) => {
      if (error) {
        throw new Error(formatConnectionError(error));
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

  const projectRoot = path.resolve(__dirname, "..", "");

  const rawValue =
    process.env.FINLYTICS_DB_PATH ||
    process.env.FINLYTICS_DATABASE_URL ||
    process.env.DATABASE_URL;

  let candidate = normalizeDatabasePath(rawValue, projectRoot);

  if (!candidate) {
    candidate = resolveDefaultDatabasePath(projectRoot, {
      forcePortable: true,
    });
  }

  if (requiresRelocation(candidate, projectRoot)) {
    candidate = resolveDefaultDatabasePath(projectRoot, {
      forcePortable: true,
    });

    if (requiresRelocation(candidate, projectRoot)) {
      candidate = path.resolve(
        os.tmpdir(),
        getAppDataFolderName(),
        "finlytics.sqlite"
      );
    }
  }

  resolvedPath = candidate;
  return resolvedPath;
}

function normalizeDatabasePath(input, projectRoot) {
  if (!input) {
    return resolveDefaultDatabasePath(projectRoot);
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

function requiresRelocation(filePath, projectRoot) {
  if (!filePath) {
    return true;
  }

  const normalizedPath = path.resolve(filePath);

  if (normalizedPath.toLowerCase().includes("app.asar")) {
    return true;
  }

  const resourcesPath = getResourcesRoot();
  if (resourcesPath && isSubPath(resourcesPath, normalizedPath)) {
    return true;
  }

  if (projectRoot && resourcesPath && isSubPath(resourcesPath, projectRoot)) {
    if (isSubPath(projectRoot, normalizedPath)) {
      return true;
    }
  }

  return false;
}

function isSubPath(parent, target) {
  if (!parent || !target) {
    return false;
  }

  const relative = path.relative(parent, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveDefaultDatabasePath(projectRoot, options = {}) {
  const shouldUsePortable = options.forcePortable || isRunningFromPackagedApp();

  if (shouldUsePortable) {
    const userDataPath = getUserDataPath();
    if (userDataPath) {
      return path.resolve(userDataPath, "finlytics.sqlite");
    }

    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
      return path.resolve(portableDir, "finlytics.sqlite");
    }

    const appDataDir = getSystemAppDataDirectory();
    if (appDataDir) {
      return path.resolve(
        appDataDir,
        getAppDataFolderName(),
        "finlytics.sqlite"
      );
    }

    return path.resolve(
      os.tmpdir(),
      getAppDataFolderName(),
      "finlytics.sqlite"
    );
  }

  return path.resolve(projectRoot, "data/finlytics.sqlite");
}

function getUserDataPath() {
  if (!electronApp || typeof electronApp.getPath !== "function") {
    return null;
  }

  try {
    const pathValue = electronApp.getPath("userData");
    if (pathValue && typeof pathValue === "string" && pathValue.trim()) {
      return pathValue;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function getSystemAppDataDirectory() {
  if (process.platform === "win32") {
    return (
      process.env.APPDATA || path.resolve(os.homedir(), "AppData", "Roaming")
    );
  }

  if (process.platform === "darwin") {
    return path.resolve(os.homedir(), "Library", "Application Support");
  }

  return process.env.XDG_DATA_HOME || path.resolve(os.homedir(), ".config");
}

let cachedAppDataFolderName = null;

function getAppDataFolderName() {
  if (cachedAppDataFolderName) {
    return cachedAppDataFolderName;
  }

  const explicit = process.env.FINLYTICS_APP_DIR_NAME;
  if (explicit && explicit.trim()) {
    cachedAppDataFolderName = explicit.trim();
    return cachedAppDataFolderName;
  }

  if (electronApp && typeof electronApp.getName === "function") {
    const name = electronApp.getName();
    if (name) {
      cachedAppDataFolderName = name;
      return cachedAppDataFolderName;
    }
  }

  try {
    const pkg = require("../package.json");
    const candidate =
      (pkg.build && pkg.build.productName) || pkg.productName || pkg.name;
    if (candidate) {
      cachedAppDataFolderName = String(candidate).trim();
      return cachedAppDataFolderName;
    }
  } catch (_error) {
    // ignore
  }

  cachedAppDataFolderName = "Finlytics";
  return cachedAppDataFolderName;
}

function isRunningFromPackagedApp() {
  if (electronApp) {
    if (typeof electronApp.isPackaged === "function") {
      return electronApp.isPackaged();
    }
    if (typeof electronApp.isPackaged === "boolean") {
      return electronApp.isPackaged;
    }
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return true;
  }

  if (process.defaultApp === false) {
    return true;
  }

  return /app\.asar/i.test(__dirname);
}

function getResourcesRoot() {
  if (process.resourcesPath) {
    return path.resolve(process.resourcesPath);
  }

  if (electronApp && typeof electronApp.getAppPath === "function") {
    try {
      const appPath = electronApp.getAppPath();
      if (appPath) {
        return path.resolve(appPath, "..");
      }
    } catch (_error) {
      // ignore and fall through
    }
  }

  return null;
}

function ensureDirectoryExists(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function ensureFileWritable(filePath) {
  try {
    const handle = fs.openSync(
      filePath,
      fs.constants.O_CREAT | fs.constants.O_RDWR
    );
    fs.closeSync(handle);
  } catch (error) {
    throw new Error(formatConnectionError(error));
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
