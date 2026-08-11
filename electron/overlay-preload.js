const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayMonitor", {
  setMode: (mode) => ipcRenderer.invoke("overlay:set-mode", mode),
  sendAction: (action, payload) => ipcRenderer.invoke("overlay:action", action, payload),
  onState: (callback) => {
    ipcRenderer.on("overlay:state", (_event, state) => callback(state));
  }
});
