const connectionLabel = document.querySelector("#connectionLabel");
const modeButtons = document.querySelector("#modeButtons");
const speedValue = document.querySelector("#speedValue");
const runState = document.querySelector("#runState");
const motionState = document.querySelector(".motion-state");

const btnPlayPreset = document.querySelector("#btnPlayPreset");
const btnStop = document.querySelector("#btnStop");

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
    button.title = `Mode ${mode}`;
    modeButtons.append(button);
  }
}

function updateModeButtons() {
  modeButtons.querySelectorAll("button").forEach((button) => {
    const selected = Number(button.dataset.mode) === activeMode;
    button.disabled = !connected || modeRequestPending;
    button.classList.toggle("active", selected);
  });
  
  if (btnPlayPreset) btnPlayPreset.disabled = !connected;
  if (btnStop) btnStop.disabled = !connected;
  document.querySelectorAll(".btn-jog").forEach(btn => btn.disabled = !connected);
}

async function setMode(mode) {
  if (!connected || modeRequestPending || !Number.isInteger(mode)) return;
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
  if (button) setMode(Number(button.dataset.mode));
});

window.overlayMonitor.onState((state) => {
  connected = Boolean(state.connected);
  activeMode = Number.isInteger(state.mode) ? state.mode : null;
  document.body.classList.toggle("offline", !connected);
  connectionLabel.textContent = connected ? "ONLINE" : "OFFLINE";
  speedValue.textContent = String(state.speed);
  runState.textContent = state.stopped ? "STOP" : "RUNNING";
  motionState.classList.toggle("running", !state.stopped);
  updateModeButtons();
});

btnPlayPreset?.addEventListener("click", () => {
  if (connected) window.overlayMonitor.sendAction("play-preset");
});

btnStop?.addEventListener("click", () => {
  if (connected) window.overlayMonitor.sendAction("stop");
});

function bindJog(id, action, dir) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener("mousedown", () => connected && window.overlayMonitor.sendAction(action, { dir }));
  btn.addEventListener("touchstart", (e) => { e.preventDefault(); connected && window.overlayMonitor.sendAction(action, { dir }); });
  btn.addEventListener("mouseup", () => connected && window.overlayMonitor.sendAction("stop"));
  btn.addEventListener("mouseleave", (e) => { if (e.buttons === 1 && connected) window.overlayMonitor.sendAction("stop"); });
  btn.addEventListener("touchend", () => connected && window.overlayMonitor.sendAction("stop"));
}

bindJog("btnJogM1Bwd", "jog-m1", 0);
bindJog("btnJogM1Fwd", "jog-m1", 1);
bindJog("btnJogM2Bwd", "jog-m2", 0);
bindJog("btnJogM2Fwd", "jog-m2", 1);

buildModeButtons();
updateModeButtons();
