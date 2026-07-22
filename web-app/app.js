const MODE_COUNT = 11;
const BAUD_RATE = 9600;
const EXPECTED_FIRMWARE_ID = "MOTION_SAFE_7";
const FIRMWARE_VERIFY_TIMEOUT_MS = 7000;
const SPEED_MIN = 0;
const SPEED_MAX = 100;
const SPEED_STEP = 1;
const BOOKMARK_STORAGE_KEY = "dualAxisModeBookmarks.v1";
const serialBridge = window.electronSerial || null;
const controlsBridge = window.electronControls || null;

const defaultModes = [
  [1000, 2000, 3, 150, 150, 1, 1, 0],
  [1500, 2300, 3, 150, 150, 1, 1, 0],
  [2000, 2500, 3, 150, 150, 1, 1, 0],
  [2300, 2700, 3, 150, 150, 1, 1, 0],
  [2500, 3000, 3, 150, 150, 1, 1, 0],
  [800, 4000, 3, 150, 150, 1, 1, 0],
  [1500, 4300, 3, 150, 150, 1, 1, 0],
  [2000, 4500, 3, 150, 150, 1, 1, 0],
  [2300, 4000, 3, 150, 150, 1, 1, 0],
  [2700, 0, 3, 150, 150, 1, 1, 0],
  [3000, 0, 3, 150, 150, 1, 1, 0]
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
const bookmarkCount = document.querySelector("#bookmarkCount");
const bookmarkEmpty = document.querySelector("#bookmarkEmpty");
const bookmarkList = document.querySelector("#bookmarkList");
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
let bookmarks = loadBookmarks();

function renderIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

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
      <td>
        <div class="mode-cell">
          <span class="mode-badge">${mode}</span>
          <button class="icon-button bookmark-mode-button" type="button" data-bookmark-mode="${mode}"
            aria-label="Bookmark Mode ${mode}" title="Bookmark Mode ${mode}">
            <i data-lucide="bookmark-plus"></i>
          </button>
        </div>
      </td>
      <td><input data-field="steps1" type="number" min="1" max="30000" step="1" value="${defaultModes[mode][0]}"></td>
      <td><input data-field="steps2" type="number" min="0" max="30000" step="1" value="${defaultModes[mode][1]}"></td>
      <td><input data-field="multiplier2" type="number" min="1" max="20" step="1" value="${defaultModes[mode][2]}"></td>
      <td><input data-field="motor2PhaseDelayPercent" type="number" min="0" max="99" step="1" value="${defaultModes[mode][7]}"></td>
      <td><input data-field="easing" type="number" min="0" max="5000" step="1" value="${defaultModes[mode][3]}"></td>
      <td><input data-field="easing2" type="number" min="0" max="5000" step="1" value="${defaultModes[mode][4]}"></td>
      <td>
        <select class="direction-select" data-field="startDirection1" aria-label="Arah awal Motor 1 Mode ${mode}"
          title="Arah awal Motor 1: atas = maju, bawah = mundur">
          <option value="1">↑</option>
          <option value="0">↓</option>
        </select>
      </td>
      <td>
        <select class="direction-select" data-field="startDirection2" aria-label="Arah awal Motor 2 Mode ${mode}"
          title="Arah awal Motor 2: atas = maju, bawah = mundur">
          <option value="1">↑</option>
          <option value="0">↓</option>
        </select>
      </td>
      <td>
        <button class="row-action icon-button" type="button" data-apply="${mode}" disabled
          aria-label="Kirim Mode ${mode}" title="Kirim Mode ${mode}">
          <i data-lucide="send"></i>
        </button>
      </td>
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
    motor2PhaseDelayPercent: Number(row.querySelector('[data-field="motor2PhaseDelayPercent"]').value),
    easing: Number(row.querySelector('[data-field="easing"]').value),
    easing2: Number(row.querySelector('[data-field="easing2"]').value),
    startDirection1: Number(row.querySelector('[data-field="startDirection1"]').value),
    startDirection2: Number(row.querySelector('[data-field="startDirection2"]').value)
  };

  const rules = {
    steps1: values.steps1 >= 1 && values.steps1 <= 30000,
    steps2: values.steps2 >= 0 && values.steps2 <= 30000,
    multiplier2: values.multiplier2 >= 1 && values.multiplier2 <= 20,
    motor2PhaseDelayPercent: values.motor2PhaseDelayPercent >= 0 && values.motor2PhaseDelayPercent <= 99,
    easing: values.easing >= 0 && values.easing <= 5000,
    easing2: values.easing2 >= 0 && values.easing2 <= 5000,
    startDirection1: values.startDirection1 === 0 || values.startDirection1 === 1,
    startDirection2: values.startDirection2 === 0 || values.startDirection2 === 1
  };

  row.querySelectorAll("input, select").forEach((control) => {
    control.classList.toggle("invalid", !rules[control.dataset.field]);
  });

  if (Object.values(rules).some((ok) => !ok)) {
    throw new Error(`Nilai mode ${mode} tidak valid`);
  }

  return values;
}

function setRowValues(mode, values) {
  const row = modeTableBody.querySelector(`tr[data-mode="${mode}"]`);
  if (!row) {
    return;
  }

  Object.entries(values).forEach(([field, value]) => {
    const control = row.querySelector(`[data-field="${field}"]`);
    if (control) {
      control.value = String(value);
      control.classList.remove("invalid");
    }
  });
}

function loadBookmarks() {
  try {
    const stored = JSON.parse(localStorage.getItem(BOOKMARK_STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch (_error) {
    return [];
  }
}

function saveBookmarks() {
  localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(bookmarks));
}

function bookmarkSummary(values) {
  const dir1 = values.startDirection1 === 1 ? "Maju" : "Mundur";
  const dir2 = values.startDirection2 === 1 ? "Maju" : "Mundur";
  return [
    `M1 ${values.steps1}`,
    `M2 ${values.steps2}`,
    `M2 x${values.multiplier2}`,
    `Delay ${values.motor2PhaseDelayPercent}%`,
    `E1 ${values.easing}`,
    `E2 ${values.easing2}`,
    `Arah ${dir1}/${dir2}`
  ];
}

function renderBookmarks() {
  bookmarkList.replaceChildren();
  bookmarkCount.textContent = `${bookmarks.length} tersimpan`;
  bookmarkEmpty.hidden = bookmarks.length > 0;

  bookmarks.forEach((bookmark) => {
    const item = document.createElement("article");
    item.className = "bookmark-item";
    item.dataset.bookmarkId = bookmark.id;

    const identity = document.createElement("div");
    identity.className = "bookmark-identity";

    const nameInput = document.createElement("input");
    nameInput.className = "bookmark-name";
    nameInput.value = bookmark.name;
    nameInput.dataset.bookmarkName = bookmark.id;
    nameInput.setAttribute("aria-label", "Nama atau catatan bookmark");

    const meta = document.createElement("span");
    meta.className = "bookmark-meta";
    meta.textContent = `Asal Mode ${bookmark.sourceMode} · ${new Date(bookmark.createdAt).toLocaleString()}`;
    identity.append(nameInput, meta);

    const summary = document.createElement("div");
    summary.className = "bookmark-summary";
    bookmarkSummary(bookmark.values).forEach((text) => {
      const value = document.createElement("span");
      value.textContent = text;
      summary.append(value);
    });

    const actions = document.createElement("div");
    actions.className = "bookmark-actions";
    const target = document.createElement("select");
    target.dataset.bookmarkTarget = bookmark.id;
    target.setAttribute("aria-label", "Mode tujuan");
    for (let mode = 0; mode < MODE_COUNT; mode++) {
      const option = document.createElement("option");
      option.value = String(mode);
      option.textContent = `Ke Mode ${mode}`;
      option.selected = mode === (Number.isInteger(activeMode) ? activeMode : bookmark.sourceMode);
      target.append(option);
    }

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.dataset.bookmarkApply = bookmark.id;
    applyButton.textContent = "Terapkan";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "bookmark-delete";
    deleteButton.dataset.bookmarkDelete = bookmark.id;
    deleteButton.textContent = "Hapus";
    actions.append(target, applyButton, deleteButton);

    item.append(identity, summary, actions);
    bookmarkList.append(item);
  });
}

function createBookmark(mode) {
  try {
    const sameModeCount = bookmarks.filter((item) => item.sourceMode === mode).length;
    bookmarks.unshift({
      id: globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: `Kandidat Mode ${mode} #${sameModeCount + 1}`,
      sourceMode: mode,
      createdAt: new Date().toISOString(),
      values: getRowValues(mode)
    });
    saveBookmarks();
    renderBookmarks();
    setCommandStatus(`Mode ${mode} dibookmark`, "ok");
  } catch (error) {
    log(error.message);
    setCommandStatus("Bookmark gagal", "error");
  }
}

async function applyBookmark(id) {
  const bookmark = bookmarks.find((item) => item.id === id);
  const target = bookmarkList.querySelector(`[data-bookmark-target="${id}"]`);
  if (!bookmark || !target) {
    return;
  }

  const mode = Number(target.value);
  setRowValues(mode, bookmark.values);
  if (writer && firmwareVerified) {
    await sendModeConfig(mode);
    await sendCommand(`MODE ${mode}`);
    setCommandStatus(`Bookmark diterapkan ke Mode ${mode}`, "ok");
  } else {
    setCommandStatus(`Bookmark disalin ke Mode ${mode}; belum dikirim`, "ok");
  }
}

function updateRowFromModeLine(parts) {
  const mode = Number(parts[1]);
  if (!Number.isInteger(mode) || mode < 0 || mode >= MODE_COUNT || parts.length < 10) {
    return;
  }

  setRowValues(mode, {
    steps1: parts[2],
    steps2: parts[3],
    multiplier2: parts[4],
    easing: parts[5],
    easing2: parts[6],
    startDirection1: parts[7],
    startDirection2: parts[8],
    motor2PhaseDelayPercent: parts[9]
  });
}

function markModeSent(mode) {
  const button = modeTableBody.querySelector(`[data-apply="${mode}"]`);
  if (!button) {
    return;
  }

  button.innerHTML = '<i data-lucide="check"></i><span>Sent</span>';
  button.setAttribute("aria-label", `Mode ${mode} terkirim`);
  button.title = `Mode ${mode} terkirim`;
  button.classList.add("sent");
  renderIcons();
  setTimeout(() => {
    button.innerHTML = '<i data-lucide="send"></i>';
    button.setAttribute("aria-label", `Kirim Mode ${mode}`);
    button.title = `Kirim Mode ${mode}`;
    button.classList.remove("sent");
    renderIcons();
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
        + ` ${values.easing2} ${values.startDirection1} ${values.startDirection2}`
        + ` ${values.motor2PhaseDelayPercent}`
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
  const applyButton = event.target.closest("[data-apply]");
  if (applyButton) {
    sendModeConfig(Number(applyButton.dataset.apply));
    return;
  }

  const bookmarkButton = event.target.closest("[data-bookmark-mode]");
  if (bookmarkButton) {
    createBookmark(Number(bookmarkButton.dataset.bookmarkMode));
  }
});
bookmarkList.addEventListener("change", (event) => {
  const nameInput = event.target.closest("[data-bookmark-name]");
  if (!nameInput) {
    return;
  }
  const bookmark = bookmarks.find((item) => item.id === nameInput.dataset.bookmarkName);
  if (bookmark) {
    bookmark.name = nameInput.value.trim() || `Kandidat Mode ${bookmark.sourceMode}`;
    nameInput.value = bookmark.name;
    saveBookmarks();
  }
});
bookmarkList.addEventListener("click", (event) => {
  const applyButton = event.target.closest("[data-bookmark-apply]");
  if (applyButton) {
    applyBookmark(applyButton.dataset.bookmarkApply);
    return;
  }

  const deleteButton = event.target.closest("[data-bookmark-delete]");
  if (deleteButton) {
    bookmarks = bookmarks.filter((item) => item.id !== deleteButton.dataset.bookmarkDelete);
    saveBookmarks();
    renderBookmarks();
    setCommandStatus("Bookmark dihapus", "ok");
  }
});

buildUi();
renderBookmarks();
renderIcons();
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
