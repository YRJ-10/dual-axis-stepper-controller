const connectionLabel = document.querySelector("#connectionLabel");
const modeValue = document.querySelector("#modeValue");
const speedValue = document.querySelector("#speedValue");
const runState = document.querySelector("#runState");
const motionState = document.querySelector(".motion-state");
const previousMode = document.querySelector("#previousMode");
const nextMode = document.querySelector("#nextMode");

const MODE_COUNT = 11;
let connected = false;
let activeMode = null;
let modeRequestPending = false;

function updateModeButtons() {
  const disabled = !connected || modeRequestPending || !Number.isInteger(activeMode);
  previousMode.disabled = disabled;
  nextMode.disabled = disabled;
}

async function changeMode(direction) {
  if (!connected || modeRequestPending || !Number.isInteger(activeMode)) {
    return;
  }

  const next = (activeMode + direction + MODE_COUNT) % MODE_COUNT;
  modeRequestPending = true;
  updateModeButtons();
  try {
    await window.overlayMonitor.setMode(next);
    activeMode = next;
    modeValue.textContent = `M${next}`;
  } finally {
    modeRequestPending = false;
    updateModeButtons();
  }
}

previousMode.addEventListener("click", () => changeMode(-1));
nextMode.addEventListener("click", () => changeMode(1));

window.overlayMonitor.onState((state) => {
  connected = Boolean(state.connected);
  activeMode = Number.isInteger(state.mode) ? state.mode : null;
  document.body.classList.toggle("offline", !connected);
  connectionLabel.textContent = connected ? "ARDUINO ONLINE" : "OFFLINE";
  modeValue.textContent = activeMode === null ? "-" : `M${activeMode}`;
  speedValue.textContent = String(state.speed);
  runState.textContent = state.stopped ? "STOP" : "RUNNING";
  motionState.classList.toggle("running", !state.stopped);
  updateModeButtons();
});
