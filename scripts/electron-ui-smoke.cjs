const { app, BrowserWindow } = require("electron");
const path = require("path");

app.commandLine.appendSwitch("headless");
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

async function drag(win, rect, modifiers = 0) {
  const debug = win.webContents.debugger;
  const start = { x: Math.round(rect.left + 8), y: Math.round(rect.top + 8) };
  const end = { x: Math.round(rect.right - 8), y: Math.round(rect.bottom - 8) };
  await debug.sendCommand("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers,
  });
  await debug.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 1,
    modifiers,
  });
  await debug.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers,
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    win.webContents.debugger.attach("1.3");

    const editorState = await evaluate(win, `(() => {
      document.querySelector("#insp-texture-paint").click();
      const editor = document.querySelector("#texture-editor");
      const canvas = document.querySelector("#texture-paint-canvas");
      const rect = canvas.getBoundingClientRect();
      return {
        open: !editor.hidden,
        width: canvas.width,
        height: canvas.height,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      };
    })()`);
    assert(editorState.open, "Texture Paint / UV Editor did not open");
    assert(editorState.width === 512 && editorState.height === 512, "Default texture size is not 512×512");

    const brushRect = {
      left: editorState.rect.left + (editorState.rect.right - editorState.rect.left) * 0.3,
      top: editorState.rect.top + (editorState.rect.bottom - editorState.rect.top) * 0.3,
      right: editorState.rect.left + (editorState.rect.right - editorState.rect.left) * 0.7,
      bottom: editorState.rect.top + (editorState.rect.bottom - editorState.rect.top) * 0.7,
    };
    await drag(win, brushRect);

    const textureResult = await evaluate(win, `(() => {
      document.querySelector("#uv-projection").value = "box";
      document.querySelector("#uv-unwrap").click();
      const uvPixels = document.querySelector("#texture-uv-canvas")
        .getContext("2d")
        .getImageData(0, 0, 512, 512)
        .data;
      const uvVisible = uvPixels.some((value, index) => index % 4 === 3 && value > 0);
      const status = document.querySelector("#texture-editor-status").textContent;
      document.querySelector("#texture-editor-apply").click();
      return {
        uvVisible,
        status,
        closed: document.querySelector("#texture-editor").hidden,
        textureName: document.querySelector(".texture-name")?.textContent,
      };
    })()`);
    assert(textureResult.uvVisible, "UV overlay was not rendered");
    assert(textureResult.status.includes("UV展開を適用しました"), "UV unwrap was not applied");
    assert(textureResult.closed, "Texture editor did not close");
    assert(textureResult.textureName && textureResult.textureName !== "なし", "Painted texture was not applied");

    const viewport = await evaluate(win, `(() => {
      document.querySelector("#editor-mode-toggle").click();
      const rect = document.querySelector("#canvas").getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    })()`);
    await drag(win, viewport, 1);
    const selectedCount = await evaluate(win, `
      Number.parseInt(document.querySelector("#vertex-selection-count").textContent, 10)
    `);
    assert(selectedCount > 0, "Alt + left-drag did not area-select vertices");

    console.log("Electron UI smoke test passed");
    win.webContents.debugger.detach();
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error.stack || error);
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
    app.exit(1);
  }
});
