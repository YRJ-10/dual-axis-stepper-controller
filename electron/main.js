const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const { SerialPort } = require("serialport");

const STOP_SHORTCUT = "numsub";
const MODE_COUNT = 11;

let mainWindow = null;
let overlayWindow = null;
let activePort = null;
let serialWriteQueue = [];
let serialWriteInProgress = false;
let globalMouseEnabled = false;
let globalMouseHelper = null;
let diagnosticLogStream = null;
let overlayState = {
  connected: false,
  mode: null,
  speed: 0,
  stopped: true
};

function startDiagnosticLog() {
  const logPath = path.join(app.getPath("userData"), "diagnostic.log");
  diagnosticLogStream = fs.createWriteStream(logPath, { flags: "w" });
  diagnosticLog("APP START");
}

function diagnosticLog(message) {
  if (!diagnosticLogStream) {
    return;
  }
  diagnosticLogStream.write(`${new Date().toISOString()} ${message}\n`);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function getGlobalMouseHelperPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "native-helper", "GlobalMouseHook.exe");
  }
  return path.join(__dirname, "..", "native-helper", "bin", "GlobalMouseHook.exe");
}

function stopGlobalMouseHook() {
  globalMouseEnabled = false;
  if (globalShortcut.isRegistered(STOP_SHORTCUT)) {
    globalShortcut.unregister(STOP_SHORTCUT);
  }
  if (globalMouseHelper) {
    globalMouseHelper.kill();
    globalMouseHelper = null;
  }
}

function registerStopShortcut() {
  if (globalShortcut.isRegistered(STOP_SHORTCUT)) {
    return true;
  }

  const registered = globalShortcut.register(STOP_SHORTCUT, () => {
    diagnosticLog("KEYBOARD STOP NUMSUB");
    sendToRenderer("global-mouse:gesture", { type: "stop", source: "numsub" });
  });
  diagnosticLog(registered
    ? "KEYBOARD NUMSUB REGISTERED"
    : "KEYBOARD NUMSUB REGISTRATION FAILED");
  return registered;
}

function startGlobalMouseHook() {
  if (globalMouseHelper) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const helper = spawn(getGlobalMouseHelperPath(), [], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let outputBuffer = "";
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) {
        helper.kill();
        reject(new Error("Global mouse helper tidak merespons"));
      }
    }, 3000);

    globalMouseHelper = helper;
    helper.stdout.on("data", (data) => {
      outputBuffer += data.toString("utf8");
      const lines = outputBuffer.split(/\r?\n/);
      outputBuffer = lines.pop() || "";

      lines.forEach((line) => {
        const message = line.trim();
        diagnosticLog(`MOUSE ${message}`);
        if (message === "READY") {
          ready = true;
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (message === "STOP") {
          sendToRenderer("global-mouse:gesture", { type: "stop" });
          return;
        }
        if (message.startsWith("SPEED ")) {
          sendToRenderer("global-mouse:gesture", {
            type: "speed",
            delta: Number(message.slice(6))
          });
          return;
        }
        if (message.startsWith("ERROR ") && !ready) {
          clearTimeout(timeout);
          reject(new Error(message.slice(6)));
        }
      });
    });
    helper.once("error", (error) => {
      clearTimeout(timeout);
      if (!ready) {
        reject(error);
      }
    });
    helper.once("exit", () => {
      clearTimeout(timeout);
      if (globalMouseHelper === helper) {
        globalMouseHelper = null;
        globalMouseEnabled = false;
        if (globalShortcut.isRegistered(STOP_SHORTCUT)) {
          globalShortcut.unregister(STOP_SHORTCUT);
        }
      }
      if (!ready) {
        reject(new Error("Global mouse helper berhenti"));
      }
    });
  });
}

function processSerialWriteQueue() {
  if (serialWriteInProgress || serialWriteQueue.length === 0) {
    return;
  }

  const item = serialWriteQueue.shift();
  if (!activePort || !activePort.isOpen) {
    diagnosticLog(`TX FAILED ${item.data.trim()} port disconnected`);
    item.reject(new Error("Port serial terputus"));
    processSerialWriteQueue();
    return;
  }

  serialWriteInProgress = true;
  diagnosticLog(`TX ${item.data.trim()}`);
  activePort.write(item.data, "utf8", (writeError) => {
    if (writeError) {
      serialWriteInProgress = false;
      item.reject(writeError);
      processSerialWriteQueue();
      return;
    }

    activePort.drain((drainError) => {
      serialWriteInProgress = false;
      if (drainError) {
        item.reject(drainError);
      } else {
        item.resolve({ written: true });
      }
      processSerialWriteQueue();
    });
  });
}

function queueSerialWrite(data) {
  return new Promise((resolve, reject) => {
    const item = { data, resolve, reject };
    const command = data.trim();
    if (command === "STOP" || command.startsWith("SPEED ")) {
      const retainedWrites = [];
      serialWriteQueue.forEach((queuedItem) => {
        if (queuedItem.data.trim().startsWith("SPEED ")) {
          diagnosticLog(`TX CANCELED ${queuedItem.data.trim()}`);
          queuedItem.resolve({ written: false, canceled: true });
        } else {
          retainedWrites.push(queuedItem);
        }
      });
      serialWriteQueue = retainedWrites;
      if (command === "STOP") {
        serialWriteQueue.unshift(item);
      } else {
        serialWriteQueue.push(item);
      }
    } else {
      serialWriteQueue.push(item);
    }
    diagnosticLog(`QUEUE ${command}`);
    processSerialWriteQueue();
  });
}

function closeActivePort() {
  return new Promise((resolve, reject) => {
    if (!activePort) {
      resolve();
      return;
    }

    const portToClose = activePort;
    activePort = null;

    if (!portToClose.isOpen) {
      resolve();
      return;
    }

    portToClose.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Dual Axis Stepper Controller",
    icon: path.join(__dirname, "..", "appicon.png"),
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    autoHideMenuBar: true,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) {
      event.preventDefault();
    }
  });
  mainWindow.loadFile(path.join(__dirname, "..", "web-app", "index.html"));
  mainWindow.on("minimize", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return;
    }
    positionOverlayWindow();
    overlayWindow.showInactive();
  });
  mainWindow.on("restore", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
    }
    overlayWindow = null;
  });
}

function positionOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const width = 370;
  const height = 124;
  const margin = 14;
  overlayWindow.setBounds({
    x: display.workArea.x + display.workArea.width - width - margin,
    y: display.workArea.y + display.workArea.height - height - margin,
    width,
    height
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 370,
    height: 124,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.setAlwaysOnTop(true, "floating");
  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
  overlayWindow.webContents.on("did-finish-load", () => {
    overlayWindow.webContents.send("overlay:state", overlayState);
  });
  positionOverlayWindow();
}

ipcMain.handle("serial:list", async () => {
  const ports = await SerialPort.list();
  return ports.map((port) => ({
    path: port.path,
    manufacturer: port.manufacturer || "",
    serialNumber: port.serialNumber || "",
    vendorId: port.vendorId || "",
    productId: port.productId || ""
  }));
});

ipcMain.handle("serial:open", async (_event, options) => {
  const portPath = options && options.path;
  const baudRate = Number(options && options.baudRate);

  if (typeof portPath !== "string" || !portPath || !Number.isInteger(baudRate)) {
    throw new Error("Port atau baud rate tidak valid");
  }

  await closeActivePort();

  const nextPort = new SerialPort({
    path: portPath,
    baudRate,
    autoOpen: false
  });

  await new Promise((resolve, reject) => {
    nextPort.open((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  activePort = nextPort;
  nextPort.on("data", (data) => {
    const text = data.toString("utf8");
    text.split(/\r?\n/).forEach((line) => {
      if (line.trim()) {
        diagnosticLog(`RX ${line.trim()}`);
      }
    });
    sendToRenderer("serial:data", text);
  });
  nextPort.on("error", (error) => {
    sendToRenderer("serial:status", { type: "error", message: error.message });
  });
  nextPort.on("close", () => {
    if (activePort === nextPort) {
      activePort = null;
    }
    sendToRenderer("serial:status", { type: "closed", path: portPath });
  });

  await new Promise((resolve) => {
    nextPort.set({ dtr: true, rts: true }, () => resolve());
  });

  return { path: portPath };
});

ipcMain.handle("serial:write", async (_event, data) => {
  if (!activePort || !activePort.isOpen) {
    throw new Error("Port serial belum terhubung");
  }
  if (typeof data !== "string") {
    throw new Error("Data serial tidak valid");
  }

  return queueSerialWrite(data);
});

ipcMain.handle("serial:close", async () => {
  await closeActivePort();
});

ipcMain.handle("global-mouse:set-enabled", async (_event, enabled) => {
  if (enabled && (!activePort || !activePort.isOpen)) {
    throw new Error("Arduino belum terhubung");
  }
  if (enabled) {
    await startGlobalMouseHook();
    if (!registerStopShortcut()) {
      stopGlobalMouseHook();
      throw new Error("Numpad - tidak dapat didaftarkan sebagai STOP");
    }
    globalMouseEnabled = true;
  } else {
    stopGlobalMouseHook();
  }
  return {
    enabled: globalMouseEnabled,
    stopShortcutEnabled: globalShortcut.isRegistered(STOP_SHORTCUT)
  };
});

ipcMain.on("overlay:update", (_event, state) => {
  overlayState = {
    connected: Boolean(state && state.connected),
    mode: state && Number.isInteger(state.mode) ? state.mode : null,
    speed: Math.max(0, Math.min(100, Number(state && state.speed) || 0)),
    stopped: Boolean(state && state.stopped)
  };
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:state", overlayState);
  }
});

ipcMain.handle("overlay:set-mode", async (_event, requestedMode) => {
  const nextMode = Number(requestedMode);
  if (!overlayState.connected || !activePort || !activePort.isOpen) {
    throw new Error("Arduino belum terhubung");
  }
  if (!Number.isInteger(nextMode) || nextMode < 0 || nextMode >= MODE_COUNT) {
    throw new Error("Mode tidak valid");
  }

  await queueSerialWrite(`MODE ${nextMode}\n`);
  return { mode: nextMode };
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    startDiagnosticLog();
    createWindow();
    createOverlayWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  diagnosticLog("APP STOP");
  if (diagnosticLogStream) {
    diagnosticLogStream.end();
    diagnosticLogStream = null;
  }
  stopGlobalMouseHook();
  if (activePort && activePort.isOpen) {
    activePort.close();
  }
});
