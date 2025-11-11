const { app, BrowserWindow } = require("electron");
const path = require("path");
const database = require("./db");

let mainWindow;

async function resolveInitialPage() {
  try {
    const db = database.getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        monthly_income REAL NOT NULL CHECK (monthly_income >= 0),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const result = await db.query(
      "SELECT id FROM user_profile ORDER BY id LIMIT 1;"
    );

    const hasProfile = Array.isArray(result.rows) && result.rows.length > 0;
    return hasProfile ? "dash.html" : "login.html";
  } catch (error) {
    console.error("Finlytics main: unable to inspect user profile", error);
    return "login.html";
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, "src/assets/logo.ico"),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      enableRemoteModule: true,
      sandbox: false,
      devTools: process.env.NODE_ENV === "development",
      autoplayPolicy: "document-user-activation-required",
    },
    frame: false,
    show: false,
  });

  const targetPage = await resolveInitialPage();
  const targetPath = path.join(__dirname, "../src/page", targetPage);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  try {
    await mainWindow.loadFile(targetPath);
  } catch (error) {
    console.error("Finlytics main: failed to load page", error);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error("Finlytics main: window creation failed", error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (mainWindow === null) {
    try {
      await createWindow();
    } catch (error) {
      console.error("Finlytics main: re-create window failed", error);
    }
  }
});
