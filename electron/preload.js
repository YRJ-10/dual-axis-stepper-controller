const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronSerial", {
  listPorts: () => ipcRenderer.invoke("serial:list"),
  open: (options) => ipcRenderer.invoke("serial:open", options),
  write: (data) => ipcRenderer.invoke("serial:write", data),
  close: () => ipcRenderer.invoke("serial:close"),
  onData: (callback) => {
    ipcRenderer.on("serial:data", (_event, data) => callback(data));
  },
  onStatus: (callback) => {
    ipcRenderer.on("serial:status", (_event, status) => callback(status));
  }
});

contextBridge.exposeInMainWorld("electronControls", {
  setGlobalMouseEnabled: (enabled) => ipcRenderer.invoke("global-mouse:set-enabled", enabled),
  updateOverlayState: (state) => ipcRenderer.send("overlay:update", state),
  onGlobalMouseGesture: (callback) => {
    ipcRenderer.on("global-mouse:gesture", (_event, gesture) => callback(gesture));
  }
});
