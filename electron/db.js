const path = require("path");

let dependencyError = null;
let Pool;

try {
  ({ Pool } = require("pg"));
} catch (error) {
  dependencyError = error;
}

let envLoaded = false;
let poolInstance = null;

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

function getPool() {
  loadEnv();

  if (dependencyError) {
    throw dependencyError;
  }

  if (!Pool) {
    throw new Error(
      "PostgreSQL driver missing. Install dependencies with `npm install`."
    );
  }

  if (!poolInstance) {
    poolInstance = createPool();
  }

  return poolInstance;
}

function createPool() {
  return new Pool(buildConnectionConfig());
}

function buildConnectionConfig() {
  const connectionString =
    process.env.FINLYTICS_DATABASE_URL || process.env.DATABASE_URL;
  const sslSetting = parseSSL(
    process.env.FINLYTICS_DB_SSL || process.env.PGSSLMODE
  );

  if (connectionString) {
    const config = { connectionString };
    if (sslSetting !== undefined) {
      config.ssl = sslSetting;
    }
    return config;
  }

  const host =
    process.env.FINLYTICS_DB_HOST || process.env.PGHOST || "localhost";
  const port = Number(
    process.env.FINLYTICS_DB_PORT || process.env.PGPORT || 5432
  );
  const user = process.env.FINLYTICS_DB_USER || process.env.PGUSER;
  const password = process.env.FINLYTICS_DB_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.FINLYTICS_DB_NAME || process.env.PGDATABASE;

  if (!user || !database) {
    throw new Error(
      "Missing database credentials. Provide FINLYTICS_DATABASE_URL or FINLYTICS_DB_HOST/USER/PASSWORD/NAME in a .env file."
    );
  }

  const config = { host, port, user, password, database };
  if (sslSetting !== undefined) {
    config.ssl = sslSetting;
  }
  return config;
}

function parseSSL(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.toString().toLowerCase();
  if (["require", "true", "1", "verify-full"].includes(normalized)) {
    return { rejectUnauthorized: false };
  }

  if (["disable", "false", "0"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

function closePool() {
  if (!poolInstance) {
    return Promise.resolve();
  }

  const closing = poolInstance.end();
  poolInstance = null;
  return closing;
}

function formatConnectionError(error) {
  const base = error?.message || "Unknown connection error.";
  return `${base} Configure PostgreSQL credentials in .env (FINLYTICS_DATABASE_URL or FINLYTICS_DB_HOST/USER/PASSWORD/NAME).`;
}

function normalizeDbError(error) {
  if (!error) {
    return "Unexpected error.";
  }

  const known = {
    28000: "Authentication failed. Check your database username or password.",
    "28P01": "Authentication failed. Check your database username or password.",
    "3D000": "Database not found. Verify FINLYTICS_DB_NAME.",
    42601: "Database query syntax error.",
  };

  if (error.code && known[error.code]) {
    return known[error.code];
  }

  return error.message || String(error);
}

module.exports = {
  dependencyError,
  getPool,
  closePool,
  query,
  loadEnv,
  parseSSL,
  formatConnectionError,
  normalizeDbError,
};
