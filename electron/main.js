const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const database = require("./db");

let mainWindow;

function emitWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("window-controls:state", {
    isMaximized: mainWindow.isMaximized(),
  });
}

ipcMain.handle("window-controls:get-state", () => ({
  isMaximized: Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()
  ),
}));

ipcMain.on("window-controls:action", (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  switch (action) {
    case "minimize":
      mainWindow.minimize();
      break;
    case "toggle-maximize":
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
    case "close":
      mainWindow.close();
      return;
    default:
      break;
  }

  emitWindowState();
});

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
    emitWindowState();
  });

  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);

  try {
    await mainWindow.loadFile(targetPath);
  } catch (error) {
    console.error("Finlytics main: failed to load page", error);
  }

  mainWindow.on("closed", () => {
    mainWindow.removeListener("maximize", emitWindowState);
    mainWindow.removeListener("unmaximize", emitWindowState);
    mainWindow.removeListener("enter-full-screen", emitWindowState);
    mainWindow.removeListener("leave-full-screen", emitWindowState);
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
