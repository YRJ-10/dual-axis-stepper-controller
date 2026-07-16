const MODE_COUNT = 11;
const BAUD_RATE = 9600;
const SPEED_MIN = 0;
const SPEED_MAX = 100;
const SPEED_STEP = 1;
const SPEED_RAMP_INTERVAL_MS = 80;

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
let speedRampTimer = null;
let speedLockEnabled = false;

function buildUi() {
  for (let mode = 0; mode < MODE_COUNT; mode++) {
    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.className = "mode-select-button";
    modeButton.dataset.modeSelect = String(mode);
    modeButton.textContent = String(mode);
    modeButton.title = `Aktifkan Mode ${mode}`;
    modeButton.setAttribute("aria-pressed", "false");
    modeButton.disabled = true;
    modeButtonGroup.append(modeButton);

    const row = document.createElement("tr");
    row.dataset.mode = String(mode);
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
  readButton.disabled = !isConnected;
  saveButton.disabled = !isConnected;
  loadButton.disabled = !isConnected;
  document.querySelectorAll("[data-apply]").forEach((button) => {
    button.disabled = !isConnected;
  });
  document.querySelectorAll("[data-mode-select]").forEach((button) => {
    button.disabled = !isConnected;
  });
  connectionStatus.textContent = isConnected ? "Terhubung ke Arduino" : "Belum terhubung";
  if (!isConnected) {
    updateActiveMode(null);
  }
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
}

function clampSpeed(value) {
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, value));
}

function updateSpeedUi(value, source = "WEB") {
  currentSpeed = clampSpeed(Number(value) || 0);
  speedSlider.value = String(currentSpeed);
  speedValue.textContent = String(currentSpeed);
  speedSource.textContent = source === "POT" ? "Potensio" : "Web UI";
}

function stopSpeedRamp() {
  if (speedRampTimer !== null) {
    clearInterval(speedRampTimer);
    speedRampTimer = null;
  }
}

function runSpeedRamp() {
  if (sentSpeed === currentSpeed) {
    stopSpeedRamp();
    return;
  }

  sentSpeed += sentSpeed < currentSpeed ? SPEED_STEP : -SPEED_STEP;
  sendCommand(`SPEED ${sentSpeed}`);
}

function setSpeedTarget(value) {
  const nextSpeed = clampSpeed(Number(value) || 0);
  if (nextSpeed === currentSpeed && speedSource.textContent === "Web UI") {
    return;
  }

  updateSpeedUi(nextSpeed, "WEB");
  if (speedRampTimer === null) {
    speedRampTimer = setInterval(runSpeedRamp, SPEED_RAMP_INTERVAL_MS);
  }
}

function setSpeedLock(enabled) {
  speedLockEnabled = enabled;
  speedPanel.classList.toggle("locked", enabled);
  speedLockButton.classList.toggle("locked", enabled);
  speedLockButton.setAttribute("aria-pressed", enabled ? "true" : "false");
  speedLockButton.textContent = enabled ? "Unlock Slider" : "Lock Slider";
  setCommandStatus(enabled ? "Slider Lock ON" : "Slider Lock OFF", enabled ? "ok" : "");
}

async function connectSerial() {
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
    setTimeout(() => sendCommand("DUMP"), 2500);
  } catch (error) {
    log(`Connect gagal: ${error.message}`);
  }
}

async function disconnectSerial() {
  keepReading = false;
  stopSpeedRamp();

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
      stopSpeedRamp();
      setCommandStatus("Kontrol balik ke potensio", "ok");
      speedSource.textContent = "Potensio";
      return;
    }
    if (parts[0] === "OK" && parts[1] === "STOP") {
      log(`< ${cleanLine}`);
      stopSpeedRamp();
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
        stopSpeedRamp();
        updateSpeedUi(0, source);
      } else {
        sentSpeed = clampSpeed(Math.round(Number(parts[2]) / 50));
        speedSource.textContent = "Web UI";
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
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(`${command}\n`));
    log(`> ${command}`);
  } catch (error) {
    log(`Write error: ${error.message}`);
  }
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
stopButton.addEventListener("click", () => {
  stopSpeedRamp();
  sentSpeed = 0;
  updateSpeedUi(0, "WEB");
  sendCommand("STOP");
});
potButton.addEventListener("click", () => {
  stopSpeedRamp();
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
  stopSpeedRamp();
  sentSpeed = 0;
  updateSpeedUi(0, "WEB");
  sendCommand("STOP");
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && speedLockEnabled) {
    setSpeedLock(false);
    return;
  }

  if (event.code === "Space" && speedLockEnabled) {
    event.preventDefault();
    stopSpeedRamp();
    sentSpeed = 0;
    updateSpeedUi(0, "WEB");
    sendCommand("STOP");
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
