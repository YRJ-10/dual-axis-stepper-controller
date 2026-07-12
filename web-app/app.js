const MODE_COUNT = 11;
const BAUD_RATE = 9600;

const defaultModes = [
  [1000, 2000, 3, 150],
  [1500, 2300, 3, 150],
  [2000, 2500, 3, 150],
  [2300, 2700, 3, 150],
  [2500, 3000, 3, 150],
  [800, 4000, 3, 150],
  [1500, 4300, 3, 150],
  [2000, 4500, 3, 150],
  [2300, 4000, 3, 150],
  [2700, 0, 3, 150],
  [3000, 0, 3, 150]
];

const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const connectionStatus = document.querySelector("#connectionStatus");
const currentActiveMode = document.querySelector("#currentActiveMode");
const activeModeSelect = document.querySelector("#activeModeSelect");
const setModeButton = document.querySelector("#setModeButton");
const readButton = document.querySelector("#readButton");
const saveButton = document.querySelector("#saveButton");
const loadButton = document.querySelector("#loadButton");
const clearLogButton = document.querySelector("#clearLogButton");
const modeTableBody = document.querySelector("#modeTableBody");
const logOutput = document.querySelector("#logOutput");

let port = null;
let reader = null;
let writer = null;
let keepReading = false;
let incomingBuffer = "";
let activeMode = null;

function buildUi() {
  for (let mode = 0; mode < MODE_COUNT; mode++) {
    const option = document.createElement("option");
    option.value = String(mode);
    option.textContent = `Mode ${mode}`;
    activeModeSelect.append(option);

    const row = document.createElement("tr");
    row.dataset.mode = String(mode);
    row.innerHTML = `
      <td><span class="mode-badge">${mode}</span></td>
      <td><input data-field="steps1" type="number" min="1" max="30000" step="1" value="${defaultModes[mode][0]}"></td>
      <td><input data-field="steps2" type="number" min="0" max="30000" step="1" value="${defaultModes[mode][1]}"></td>
      <td><input data-field="multiplier2" type="number" min="1" max="20" step="1" value="${defaultModes[mode][2]}"></td>
      <td><input data-field="easing" type="number" min="0" max="5000" step="1" value="${defaultModes[mode][3]}"></td>
      <td><button class="row-action" type="button" data-apply="${mode}" disabled>Send</button></td>
    `;
    modeTableBody.append(row);
  }
}

function setConnectedState(isConnected) {
  connectButton.disabled = isConnected;
  disconnectButton.disabled = !isConnected;
  setModeButton.disabled = !isConnected;
  readButton.disabled = !isConnected;
  saveButton.disabled = !isConnected;
  loadButton.disabled = !isConnected;
  document.querySelectorAll("[data-apply]").forEach((button) => {
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

function getRowValues(mode) {
  const row = modeTableBody.querySelector(`tr[data-mode="${mode}"]`);
  const values = {
    steps1: Number(row.querySelector('[data-field="steps1"]').value),
    steps2: Number(row.querySelector('[data-field="steps2"]').value),
    multiplier2: Number(row.querySelector('[data-field="multiplier2"]').value),
    easing: Number(row.querySelector('[data-field="easing"]').value)
  };

  const rules = {
    steps1: values.steps1 >= 1 && values.steps1 <= 30000,
    steps2: values.steps2 >= 0 && values.steps2 <= 30000,
    multiplier2: values.multiplier2 >= 1 && values.multiplier2 <= 20,
    easing: values.easing >= 0 && values.easing <= 5000
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
}

function updateActiveMode(mode) {
  activeMode = mode;
  currentActiveMode.textContent = mode === null ? "-" : `Mode ${mode}`;
  document.querySelectorAll("#modeTableBody tr").forEach((row) => {
    row.classList.toggle("active-row", Number(row.dataset.mode) === mode);
  });
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
    await sendCommand(
      `SET ${mode} ${values.steps1} ${values.steps2} ${values.multiplier2} ${values.easing}`
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
setModeButton.addEventListener("click", () => {
  sendCommand(`MODE ${activeModeSelect.value}`);
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
