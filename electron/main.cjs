const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// GPUがブロックされている環境(VM/ヘッドレス)でもWebGLを使えるように
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
app.commandLine.appendSwitch("use-angle", "default");
app.disableHardwareAcceleration = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#1d1d1d",
    title: "Rentana 3D Editor",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ---------------- ファイル保存 IPC ---------------- */
ipcMain.handle("save-file", async (_evt, opts) => {
  // opts: { defaultPath, filters: [{name, extensions}] }
  const result = await dialog.showSaveDialog({
    title: "エクスポート",
    defaultPath: opts.defaultPath || "untitled",
    filters: opts.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  // 書き込みは別IPCで本体を受け取る（バイナリはTransferable不変なのでArrayBuffer送信）
  return { ok: true, path: result.filePath };
});

ipcMain.handle("write-binary", async (_evt, filePath, buffer) => {
  // buffer: ArrayBuffer (rendererから送られてくる)
  try {
    await fs.writeFile(filePath, Buffer.from(buffer));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("write-text", async (_evt, filePath, text) => {
  try {
    await fs.writeFile(filePath, text, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("save-dialog-glb", async () => {
  const result = await dialog.showSaveDialog({
    title: "GLBエクスポート",
    defaultPath: `scene-${Date.now()}.glb`,
    filters: [
      { name: "GLB Binary", extensions: ["glb"] },
      { name: "GLTF Text", extensions: ["gltf"] },
    ],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  return { ok: true, path: result.filePath };
});