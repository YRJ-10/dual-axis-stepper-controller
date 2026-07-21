const MODE_COUNT = 11;
const BAUD_RATE = 9600;
const EXPECTED_FIRMWARE_ID = "MOTION_SAFE_4";
const FIRMWARE_VERIFY_TIMEOUT_MS = 7000;
const SPEED_MIN = 0;
const SPEED_MAX = 100;
const SPEED_STEP = 1;
const serialBridge = window.electronSerial || null;
const controlsBridge = window.electronControls || null;

const defaultModes = [
  [1000, 2000, 3, 150, 150],
  [1500, 2300, 3, 150, 150],
  [2000, 2500, 3, 150, 150],
  [2300, 2700, 3, 150, 150],
  [2500, 3000, 3, 150, 150],
  [800, 4000, 3, 150, 150],
  [1500, 4300, 3, 150, 150],
  [2000, 4500, 3, 150, 150],
  [2300, 4000, 3, 150, 150],
  [2700, 0, 3, 150, 150],
  [3000, 0, 3, 150, 150]
];

const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const connectionStatus = document.querySelector("#connectionStatus");
const desktopPortControls = document.querySelector("#desktopPortControls");
const serialPortSelect = document.querySelector("#serialPortSelect");
const refreshPortsButton = document.querySelector("#refreshPortsButton");
const currentActiveMode = document.querySelector("#currentActiveMode");
const modeButtonGroup = document.querySelector("#modeButtonGroup");
const readButton = document.querySelector("#readButton");
const saveButton = document.querySelector("#saveButton");
const loadButton = document.querySelector("#loadButton");
const clearLogButton = document.querySelector("#clearLogButton");
const commandStatus = document.querySelector("#commandStatus");
const speedPanel = document.querySelector("#speedPanel");
const speedValue = document.querySelector("#speedValue");
const speedSource = document.querySelector("#speedSource");
const speedSlider = document.querySelector("#speedSlider");
const globalMouseButton = document.querySelector("#globalMouseButton");
const speedLockButton = document.querySelector("#speedLockButton");
const stopButton = document.querySelector("#stopButton");
const potButton = document.querySelector("#potButton");
const modeTableBody = document.querySelector("#modeTableBody");
const logOutput = document.querySelector("#logOutput");

let port = null;
let reader = null;
let writer = null;
let keepReading = false;
let incomingBuffer = "";
let activeMode = null;
let lastSentMode = null;
let currentSpeed = 0;
let sentSpeed = 0;
let speedLockEnabled = false;
let globalMouseEnabled = false;
let stopPending = false;
let stopReleaseTimer = null;
let firmwareVerified = false;
let firmwareVerificationTimer = null;
let firmwareVerificationFailed = false;

function syncOverlayState() {
  if (!controlsBridge || typeof controlsBridge.updateOverlayState !== "function") {
    return;
  }
  controlsBridge.updateOverlayState({
    connected: Boolean(port && writer && firmwareVerified),
    mode: activeMode,
    speed: sentSpeed,
    stopped: sentSpeed === 0
  });
}

function clearFirmwareVerificationTimer() {
  if (firmwareVerificationTimer !== null) {
    clearTimeout(firmwareVerificationTimer);
    firmwareVerificationTimer = null;
  }
}

function updateControlAvailability() {
  const isConnected = Boolean(port && writer);
  const controllerReady = isConnected && firmwareVerified;

  readButton.disabled = !controllerReady;
  saveButton.disabled = !controllerReady;
  loadButton.disabled = !controllerReady;
  speedSlider.disabled = !controllerReady;
  speedLockButton.disabled = !controllerReady;
  potButton.disabled = !controllerReady;
  stopButton.disabled = !isConnected;

  document.querySelectorAll("[data-apply]").forEach((button) => {
    button.disabled = !controllerReady;
  });
  document.querySelectorAll("[data-mode-select]").forEach((button) => {
    button.disabled = !controllerReady;
  });

  if (controlsBridge) {
    globalMouseButton.disabled = !controllerReady;
    if (!controllerReady && globalMouseEnabled) {
      setGlobalMouseControl(false);
    }
  }

  const portLabel = serialBridge && port && port.path ? ` (${port.path})` : "";
  connectionStatus.textContent = !isConnected
    ? "Belum terhubung"
    : firmwareVerified
      ? `Terhubung ke Arduino${portLabel} · Firmware Verified`
      : `Terhubung ke Arduino${portLabel} · Memverifikasi firmware`;
  syncOverlayState();
}

function confirmFirmware(firmwareId) {
  clearFirmwareVerificationTimer();
  if (firmwareId !== EXPECTED_FIRMWARE_ID) {
    firmwareVerified = false;
    if (!firmwareVerificationFailed) {
      firmwareVerificationFailed = true;
      log(`Firmware Mismatch: ${firmwareId || "tidak diketahui"}`);
    }
    setCommandStatus("Firmware Mismatch", "error");
    updateControlAvailability();
    return;
  }

  const firstVerification = !firmwareVerified;
  firmwareVerified = true;
  firmwareVerificationFailed = false;
  updateControlAvailability();
  if (firstVerification) {
    log("Firmware Verified");
    setCommandStatus("Firmware Verified", "ok");
    sendCommand("DUMP");
  }
}

function beginFirmwareVerification() {
  firmwareVerified = false;
  firmwareVerificationFailed = false;
  clearFirmwareVerificationTimer();
  updateControlAvailability();
  setCommandStatus("Memverifikasi firmware...");

  firmwareVerificationTimer = setTimeout(() => {
    firmwareVerificationTimer = null;
    if (!port || !writer || firmwareVerified) {
      return;
    }
    firmwareVerificationFailed = true;
    log("Firmware Verification Failed");
    setCommandStatus("Firmware Verification Failed", "error");
    updateControlAvailability();
  }, FIRMWARE_VERIFY_TIMEOUT_MS);

  setTimeout(async () => {
    if (!port || !writer || firmwareVerified) {
      return;
    }
    sentSpeed = 0;
    updateSpeedUi(0, "WEB");
    await sendCommand("STOP");
    await sendCommand("INFO");
  }, 2500);
}

async function refreshElectronPorts() {
  if (!serialBridge) {
    return [];
  }

  const ports = await serialBridge.listPorts();
  const selectedPath = serialPortSelect.value
    || localStorage.getItem("lastSerialPort")
    || "";
  serialPortSelect.replaceChildren();

  if (ports.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Tidak ada port COM";
    serialPortSelect.append(option);
    connectButton.disabled = true;
    return ports;
  }

  ports.forEach((item) => {
    const option = document.createElement("option");
    const details = item.manufacturer ? ` - ${item.manufacturer}` : "";
    option.value = item.path;
    option.textContent = `${item.path}${details}`;
    serialPortSelect.append(option);
  });

  if (ports.some((item) => item.path === selectedPath)) {
    serialPortSelect.value = selectedPath;
  }
  connectButton.disabled = false;
  return ports;
}

function buildUi() {
  const independentGroup = document.createElement("div");
  independentGroup.className = "mode-cluster mode-cluster-independent";
  independentGroup.innerHTML = '<span class="mode-cluster-label">Independen</span><div class="mode-cluster-buttons"></div>';

  const coupledGroup = document.createElement("div");
  coupledGroup.className = "mode-cluster mode-cluster-coupled";
  coupledGroup.innerHTML = '<span class="mode-cluster-label">Coupled</span><div class="mode-cluster-buttons"></div>';

  modeButtonGroup.append(independentGroup, coupledGroup);

  for (let mode = 0; mode < MODE_COUNT; mode++) {
    const isCoupled = mode >= 6;
    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.className = "mode-select-button";
    modeButton.dataset.modeSelect = String(mode);
    modeButton.textContent = String(mode);
    modeButton.classList.add(isCoupled ? "coupled" : "independent");
    modeButton.title = `Aktifkan Mode ${mode} (${isCoupled ? "Coupled" : "Independen"})`;
    modeButton.setAttribute("aria-pressed", "false");
    modeButton.disabled = true;
    const targetGroup = isCoupled ? coupledGroup : independentGroup;
    targetGroup.querySelector(".mode-cluster-buttons").append(modeButton);

    const row = document.createElement("tr");
    row.dataset.mode = String(mode);
    row.classList.add(isCoupled ? "coupled-mode-row" : "independent-mode-row");
    if (mode === 6) {
      row.classList.add("mode-group-start");
    }
    row.innerHTML = `
      <td><span class="mode-badge">${mode}</span></td>
      <td><input data-field="steps1" type="number" min="1" max="30000" step="1" value="${defaultModes[mode][0]}"></td>
      <td><input data-field="steps2" type="number" min="0" max="30000" step="1" value="${defaultModes[mode][1]}"></td>
      <td><input data-field="multiplier2" type="number" min="1" max="20" step="1" value="${defaultModes[mode][2]}"></td>
      <td><input data-field="easing" type="number" min="0" max="5000" step="1" value="${defaultModes[mode][3]}"></td>
      <td><input data-field="easing2" type="number" min="0" max="5000" step="1" value="${defaultModes[mode][4]}"></td>
      <td><button class="row-action" type="button" data-apply="${mode}" disabled>Send</button></td>
    `;
    modeTableBody.append(row);
  }
}

function setConnectedState(isConnected) {
  connectButton.disabled = isConnected;
  disconnectButton.disabled = !isConnected;
  if (serialBridge) {
    serialPortSelect.disabled = isConnected;
    refreshPortsButton.disabled = isConnected;
  }
  if (!isConnected) {
    clearFirmwareVerificationTimer();
    firmwareVerified = false;
    firmwareVerificationFailed = false;
    updateActiveMode(null);
  }
  updateControlAvailability();
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  logOutput.textContent += `[${time}] ${message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setCommandStatus(message, state = "") {
  commandStatus.textContent = message;
  commandStatus.classList.toggle("ok", state === "ok");
  commandStatus.classList.toggle("error", state === "error");
}

function getRowValues(mode) {
  const row = modeTableBody.querySelector(`tr[data-mode="${mode}"]`);
  const values = {
    steps1: Number(row.querySelector('[data-field="steps1"]').value),
    steps2: Number(row.querySelector('[data-field="steps2"]').value),
    multiplier2: Number(row.querySelector('[data-field="multiplier2"]').value),
    easing: Number(row.querySelector('[data-field="easing"]').value),
    easing2: Number(row.querySelector('[data-field="easing2"]').value)
  };

  const rules = {
    steps1: values.steps1 >= 1 && values.steps1 <= 30000,
    steps2: values.steps2 >= 0 && values.steps2 <= 30000,
    multiplier2: values.multiplier2 >= 1 && values.multiplier2 <= 20,
    easing: values.easing >= 0 && values.easing <= 5000,
    easing2: values.easing2 >= 0 && values.easing2 <= 5000
  };

  row.querySelectorAll("input").forEach((input) => {
    input.classList.toggle("invalid", !rules[input.dataset.field]);
  });

  if (Object.values(rules).some((ok) => !ok)) {
    throw new Error(`Nilai mode ${mode} tidak valid`);
  }

  return values;
}

function updateRowFromModeLine(parts) {
  const mode = Number(parts[1]);
  if (!Number.isInteger(mode) || mode < 0 || mode >= MODE_COUNT || parts.length < 6) {
    return;
  }

  const row = modeTableBody.querySelector(`tr[data-mode="${mode}"]`);
  row.querySelector('[data-field="steps1"]').value = parts[2];
  row.querySelector('[data-field="steps2"]').value = parts[3];
  row.querySelector('[data-field="multiplier2"]').value = parts[4];
  row.querySelector('[data-field="easing"]').value = parts[5];
  row.querySelector('[data-field="easing2"]').value = parts[6] || parts[5];
}

function markModeSent(mode) {
  const button = modeTableBody.querySelector(`[data-apply="${mode}"]`);
  if (!button) {
    return;
  }

  const originalText = button.textContent;
  button.textContent = "Sent";
  button.classList.add("sent");
  setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove("sent");
  }, 1200);
}

function updateActiveMode(mode) {
  activeMode = mode;
  currentActiveMode.textContent = mode === null ? "-" : `Mode ${mode}`;
  document.querySelectorAll("[data-mode-select]").forEach((button) => {
    const isActive = Number(button.dataset.modeSelect) === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  document.querySelectorAll("#modeTableBody tr").forEach((row) => {
    row.classList.toggle("active-row", Number(row.dataset.mode) === mode);
  });
  syncOverlayState();
}

function clampSpeed(value) {
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, value));
}

function updateSpeedUi(value, source = "WEB") {
  currentSpeed = clampSpeed(Number(value) || 0);
  speedSlider.value = String(currentSpeed);
  speedValue.textContent = String(currentSpeed);
  speedSource.textContent = source === "POT" ? "Potensio" : "Web UI";
  syncOverlayState();
}

function setSpeedTarget(value) {
  if (stopPending || !firmwareVerified || !writer) {
    return;
  }

  const nextSpeed = clampSpeed(Number(value) || 0);
  if (nextSpeed === currentSpeed && speedSource.textContent === "Web UI") {
    return;
  }

  sentSpeed = nextSpeed;
  updateSpeedUi(nextSpeed, "WEB");
  sendCommand(`SPEED ${sentSpeed}`);
}

function releaseStopPending() {
  stopPending = false;
  if (stopReleaseTimer !== null) {
    clearTimeout(stopReleaseTimer);
    stopReleaseTimer = null;
  }
}

function requestStop() {
  if (stopPending) {
    return;
  }

  stopPending = true;
  sentSpeed = 0;
  updateSpeedUi(0, "WEB");
  sendCommand("STOP");
  stopReleaseTimer = setTimeout(releaseStopPending, 1500);
}

function setSpeedLock(enabled) {
  speedLockEnabled = enabled;
  speedPanel.classList.toggle("locked", enabled);
  speedLockButton.classList.toggle("locked", enabled);
  speedLockButton.setAttribute("aria-pressed", enabled ? "true" : "false");
  speedLockButton.textContent = enabled ? "Unlock Slider" : "Lock Slider";
  setCommandStatus(enabled ? "Slider Lock ON" : "Slider Lock OFF", enabled ? "ok" : "");
}

async function setGlobalMouseControl(enabled) {
  if (!controlsBridge) {
    return;
  }

  try {
    const result = await controlsBridge.setGlobalMouseEnabled(enabled);
    globalMouseEnabled = result.enabled;
    globalMouseButton.classList.toggle("enabled", globalMouseEnabled);
    globalMouseButton.setAttribute("aria-pressed", globalMouseEnabled ? "true" : "false");
    globalMouseButton.textContent = globalMouseEnabled
      ? "Global Mouse ON"
      : "Global Mouse OFF";
    setCommandStatus(
      globalMouseEnabled && result.stopShortcutEnabled
        ? "Global Mouse + Numpad - aktif"
        : "Global Mouse nonaktif",
      globalMouseEnabled ? "ok" : ""
    );
  } catch (error) {
    log(`Global Mouse gagal: ${error.message}`);
    setCommandStatus("Global Mouse gagal", "error");
  }
}

async function connectSerial() {
  if (serialBridge) {
    try {
      if (!serialPortSelect.value) {
        await refreshElectronPorts();
      }
      const selectedPath = serialPortSelect.value;
      if (!selectedPath) {
        throw new Error("Tidak ada port COM yang terdeteksi");
      }
      await serialBridge.open({ path: selectedPath, baudRate: BAUD_RATE });
      localStorage.setItem("lastSerialPort", selectedPath);
      incomingBuffer = "";
      port = { path: selectedPath, desktop: true };
      writer = { desktop: true };
      keepReading = true;
      setConnectedState(true);
      log(`Connected ${selectedPath}`);
      beginFirmwareVerification();
    } catch (error) {
      log(`Connect gagal: ${error.message}`);
    }
    return;
  }

  if (!("serial" in navigator)) {
    log("Browser tidak support Web Serial. Pakai Chrome atau Edge.");
    return;
  }

  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD_RATE });
    await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    writer = port.writable.getWriter();
    keepReading = true;
    readLoop();
    setConnectedState(true);
    log("Connected");
    beginFirmwareVerification();
  } catch (error) {
    log(`Connect gagal: ${error.message}`);
  }
}

async function disconnectSerial() {
  keepReading = false;

  if (serialBridge) {
    try {
      await serialBridge.close();
      incomingBuffer = "";
      port = null;
      writer = null;
      setConnectedState(false);
      log("Disconnected");
    } catch (error) {
      log(`Disconnect gagal: ${error.message}`);
    }
    return;
  }

  try {
    if (reader) {
      await reader.cancel();
      reader.releaseLock();
      reader = null;
    }
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
    if (port) {
      await port.close();
      port = null;
    }
    setConnectedState(false);
    log("Disconnected");
  } catch (error) {
    log(`Disconnect gagal: ${error.message}`);
  }
}

async function readLoop() {
  const decoder = new TextDecoder();

  while (port && port.readable && keepReading) {
    reader = port.readable.getReader();
    try {
      while (keepReading) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        incomingBuffer += decoder.decode(value, { stream: true });
        flushIncomingLines();
      }
    } catch (error) {
      if (keepReading) {
        log(`Read error: ${error.message}`);
      }
    } finally {
      reader.releaseLock();
      reader = null;
    }
  }
}

function flushIncomingLines() {
  const lines = incomingBuffer.split(/\r?\n/);
  incomingBuffer = lines.pop() || "";

  lines.forEach((line) => {
    const cleanLine = line.trim();
    if (!cleanLine) {
      return;
    }
    const parts = cleanLine.split(/\s+/);
    if (parts[0] === "FW") {
      log(`< ${cleanLine}`);
      confirmFirmware(parts[1] || "");
      return;
    }
    if (parts[0] === "OK" && parts[1] === "SET") {
      log(`< ${cleanLine}`);
      const mode = Number(parts[2]);
      if (Number.isInteger(mode)) {
        setCommandStatus(`Mode ${mode} terkirim`, "ok");
        markModeSent(mode);
      } else {
        setCommandStatus("Setting terkirim", "ok");
      }
      return;
    }
    if (parts[0] === "OK" && parts[1] === "SAVE") {
      log(`< ${cleanLine}`);
      setCommandStatus("EEPROM tersimpan", "ok");
      return;
    }
    if (parts[0] === "OK" && parts[1] === "LOAD") {
      log(`< ${cleanLine}`);
      setCommandStatus("EEPROM dimuat", "ok");
      return;
    }
    if (parts[0] === "OK" && parts[1] === "SPEED") {
      log(`< ${cleanLine}`);
      setCommandStatus(`Speed ${parts[2]}%`, "ok");
      return;
    }
    if (parts[0] === "OK" && parts[1] === "POT") {
      log(`< ${cleanLine}`);
      setCommandStatus("Kontrol balik ke potensio", "ok");
      speedSource.textContent = "Potensio";
      return;
    }
    if (parts[0] === "OK" && parts[1] === "STOP") {
      log(`< ${cleanLine}`);
      releaseStopPending();
      sentSpeed = 0;
      updateSpeedUi(0, "WEB");
      setCommandStatus("Stop", "ok");
      return;
    }
    if (parts[0] === "ERR") {
      log(`< ${cleanLine}`);
      setCommandStatus(cleanLine, "error");
      return;
    }
    if (parts[0] === "MODE") {
      log(`< ${cleanLine}`);
      updateRowFromModeLine(parts);
      return;
    }
    if (parts[0] === "ACTIVE") {
      const mode = Number(parts[1]);
      if (Number.isInteger(mode) && mode >= 0 && mode < MODE_COUNT) {
        if (activeMode !== mode) {
          log(`< ${cleanLine}`);
        }
        updateActiveMode(mode);
      }
      return;
    }
    if (parts[0] === "SPEED") {
      const source = parts[1] === "POT" ? "POT" : "WEB";
      if (source === "POT") {
        sentSpeed = 0;
        updateSpeedUi(0, source);
      } else {
        sentSpeed = clampSpeed(Math.round(Number(parts[2]) / 50));
        speedSource.textContent = "Web UI";
        syncOverlayState();
      }
      log(`< ${cleanLine}`);
      return;
    }
    log(`< ${cleanLine}`);
  });
}

async function sendCommand(command) {
  if (!writer) {
    log("Belum connect");
    return;
  }

  try {
    if (serialBridge) {
      const result = await serialBridge.write(`${command}\n`);
      if (result && result.canceled) {
        return;
      }
      log(`> ${command}`);
      return;
    }

    const encoder = new TextEncoder();
    await writer.write(encoder.encode(`${command}\n`));
    log(`> ${command}`);
  } catch (error) {
    log(`Write error: ${error.message}`);
  }
}

if (serialBridge) {
  serialBridge.onData((data) => {
    incomingBuffer += data;
    flushIncomingLines();
  });
  serialBridge.onStatus((status) => {
    if (status.type === "error") {
      log(`Serial error: ${status.message}`);
      return;
    }
    if (status.type === "closed" && port) {
      port = null;
      writer = null;
      keepReading = false;
      setConnectedState(false);
      log("Port serial terputus");
    }
  });
}

async function sendModeConfig(mode) {
  try {
    const values = getRowValues(mode);
    lastSentMode = mode;
    setCommandStatus(`Mengirim Mode ${mode}...`);
    await sendCommand(
      `SET ${mode} ${values.steps1} ${values.steps2} ${values.multiplier2} ${values.easing}`
        + ` ${values.easing2}`
    );
  } catch (error) {
    log(error.message);
  }
}

connectButton.addEventListener("click", connectSerial);
disconnectButton.addEventListener("click", disconnectSerial);
refreshPortsButton.addEventListener("click", async () => {
  try {
    await refreshElectronPorts();
    setCommandStatus("Daftar COM diperbarui", "ok");
  } catch (error) {
    log(`Refresh COM gagal: ${error.message}`);
    setCommandStatus("Refresh COM gagal", "error");
  }
});
readButton.addEventListener("click", () => sendCommand("DUMP"));
saveButton.addEventListener("click", () => sendCommand("SAVE"));
loadButton.addEventListener("click", () => sendCommand("LOAD"));
modeButtonGroup.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode-select]");
  if (!button) {
    return;
  }
  sendCommand(`MODE ${button.dataset.modeSelect}`);
});
speedSlider.addEventListener("input", () => {
  setSpeedTarget(speedSlider.value);
});
speedPanel.addEventListener("wheel", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const direction = event.deltaY < 0 ? 1 : -1;
  setSpeedTarget(Number(speedSlider.value) + direction * SPEED_STEP);
});
speedLockButton.addEventListener("click", () => {
  setSpeedLock(!speedLockEnabled);
});
globalMouseButton.addEventListener("click", () => {
  setGlobalMouseControl(!globalMouseEnabled);
});
stopButton.addEventListener("click", () => {
  requestStop();
});
potButton.addEventListener("click", () => {
  sendCommand("POT");
});
window.addEventListener("wheel", (event) => {
  if (!speedLockEnabled || event.defaultPrevented) {
    return;
  }

  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  setSpeedTarget(Number(speedSlider.value) + direction * SPEED_STEP);
}, { passive: false });
window.addEventListener("mousedown", (event) => {
  if (!speedLockEnabled || event.button !== 1) {
    return;
  }

  event.preventDefault();
  requestStop();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && speedLockEnabled) {
    setSpeedLock(false);
    return;
  }

  if (event.code === "Space" && speedLockEnabled) {
    event.preventDefault();
    requestStop();
  }
});
clearLogButton.addEventListener("click", () => {
  logOutput.textContent = "";
});
modeTableBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-apply]");
  if (!button) {
    return;
  }
  sendModeConfig(Number(button.dataset.apply));
});

buildUi();
setConnectedState(false);
if (serialBridge) {
  desktopPortControls.hidden = false;
  refreshElectronPorts().catch((error) => {
    log(`Daftar COM gagal: ${error.message}`);
  });
}
if (controlsBridge) {
  globalMouseButton.hidden = false;
  controlsBridge.onGlobalMouseGesture((gesture) => {
    if (!globalMouseEnabled) {
      return;
    }
    if (gesture.type === "speed") {
      setSpeedTarget(Number(speedSlider.value) + gesture.delta * SPEED_STEP);
      return;
    }
    if (gesture.type === "stop") {
      requestStop();
    }
  });
}
