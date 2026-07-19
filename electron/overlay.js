const connectionLabel = document.querySelector("#connectionLabel");
const modeValue = document.querySelector("#modeValue");
const speedValue = document.querySelector("#speedValue");
const runState = document.querySelector("#runState");
const motionState = document.querySelector(".motion-state");

window.overlayMonitor.onState((state) => {
  document.body.classList.toggle("offline", !state.connected);
  connectionLabel.textContent = state.connected ? "ARDUINO ONLINE" : "OFFLINE";
  modeValue.textContent = state.mode === null ? "-" : `M${state.mode}`;
  speedValue.textContent = String(state.speed);
  runState.textContent = state.stopped ? "STOP" : "RUNNING";
  motionState.classList.toggle("running", !state.stopped);
});
