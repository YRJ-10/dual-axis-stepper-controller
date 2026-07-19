const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayMonitor", {
  setMode: (mode) => ipcRenderer.invoke("overlay:set-mode", mode),
  onState: (callback) => {
    ipcRenderer.on("overlay:state", (_event, state) => callback(state));
  }
});
