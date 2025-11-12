let electronApi;
try {
  electronApi = require("electron");
} catch (_error) {
  electronApi = null;
}

const ipcRenderer = electronApi?.ipcRenderer;

function sendAction(action) {
  if (!ipcRenderer) {
    return;
  }
  ipcRenderer.send("window-controls:action", action);
}

function updateMaximizeButton(maximizeBtn, isMaximized) {
  if (!maximizeBtn) {
    return;
  }

  const icon = maximizeBtn.querySelector("i");
  const maximized = Boolean(isMaximized);
  maximizeBtn.dataset.windowState = maximized ? "restore" : "maximize";
  maximizeBtn.setAttribute(
    "aria-label",
    maximized ? "Restore window" : "Maximize window"
  );

  if (!icon) {
    return;
  }

  icon.classList.remove("fa-window-maximize", "fa-window-restore");
  icon.classList.add(maximized ? "fa-window-restore" : "fa-window-maximize");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!ipcRenderer) {
    return;
  }

  const minimizeBtn = document.querySelector(
    '[data-window-control="minimize"]'
  );
  const maximizeBtn = document.querySelector(
    '[data-window-control="maximize"]'
  );
  const closeBtn = document.querySelector('[data-window-control="close"]');

  minimizeBtn?.addEventListener("click", () => sendAction("minimize"));
  maximizeBtn?.addEventListener("click", () => sendAction("toggle-maximize"));
  closeBtn?.addEventListener("click", () => sendAction("close"));

  ipcRenderer.on("window-controls:state", (_event, payload) => {
    updateMaximizeButton(maximizeBtn, payload?.isMaximized);
  });

  ipcRenderer
    .invoke("window-controls:get-state")
    .then((state) => updateMaximizeButton(maximizeBtn, state?.isMaximized))
    .catch(() => {
      updateMaximizeButton(maximizeBtn, false);
    });
});
