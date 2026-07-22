const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rentanaIO", {
  pickExportPath: () => ipcRenderer.invoke("save-dialog-glb"),
  writeBinary: (filePath, buffer) => ipcRenderer.invoke("write-binary", filePath, buffer),
  writeText: (filePath, text) => ipcRenderer.invoke("write-text", filePath, text),
  saveFile: (opts) => ipcRenderer.invoke("save-file", opts),
});