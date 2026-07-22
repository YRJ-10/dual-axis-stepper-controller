const connectionLabel = document.querySelector("#connectionLabel");
const modeButtons = document.querySelector("#modeButtons");
const speedValue = document.querySelector("#speedValue");
const runState = document.querySelector("#runState");
const motionState = document.querySelector(".motion-state");

const MODE_COUNT = 11;
let connected = false;
let activeMode = null;
let modeRequestPending = false;

function buildModeButtons() {
  for (let mode = 0; mode < MODE_COUNT; mode++) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = String(mode);
    button.textContent = String(mode);
    button.setAttribute("aria-label", `Aktifkan Mode ${mode}`);
    button.setAttribute("aria-pressed", "false");
    button.title = `Aktifkan Mode ${mode}`;
    modeButtons.append(button);
  }
}

function updateModeButtons() {
  modeButtons.querySelectorAll("button").forEach((button) => {
    const selected = Number(button.dataset.mode) === activeMode;
    button.disabled = !connected || modeRequestPending;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function setMode(mode) {
  if (!connected || modeRequestPending || !Number.isInteger(mode)) {
    return;
  }

  modeRequestPending = true;
  updateModeButtons();
  try {
    await window.overlayMonitor.setMode(mode);
    activeMode = mode;
  } finally {
    modeRequestPending = false;
    updateModeButtons();
  }
}

modeButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (button) {
    setMode(Number(button.dataset.mode));
  }
});

window.overlayMonitor.onState((state) => {
  connected = Boolean(state.connected);
  activeMode = Number.isInteger(state.mode) ? state.mode : null;
  document.body.classList.toggle("offline", !connected);
  connectionLabel.textContent = connected ? "ARDUINO ONLINE" : "OFFLINE";
  speedValue.textContent = String(state.speed);
  runState.textContent = state.stopped ? "STOP" : "RUNNING";
  motionState.classList.toggle("running", !state.stopped);
  updateModeButtons();
});

buildModeButtons();
updateModeButtons();
