const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayMonitor", {
  onState: (callback) => {
    ipcRenderer.on("overlay:state", (_event, state) => callback(state));
  }
});
