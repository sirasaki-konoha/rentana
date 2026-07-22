import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/* ============================================================
   Rentana 3D Editor
   ============================================================ */

const canvas = document.getElementById("canvas");
const viewport = document.getElementById("viewport");

/* ---------- Renderer ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* ---------- Scene ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x303030);

const grid = new THREE.GridHelper(40, 40, 0x555555, 0x3a3a3a);
grid.material.transparent = true;
grid.material.opacity = 0.6;
scene.add(grid);

const axesHelper = new THREE.AxesHelper(2);
axesHelper.material.depthTest = false;
axesHelper.renderOrder = 1;
scene.add(axesHelper);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.25 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.001;
ground.receiveShadow = true;
ground.userData.helper = true;
scene.add(ground);

/* ---------- Lights ---------- */
const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
sun.userData.helper = true;
scene.add(sun);

/* ---------- Camera ---------- */
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(7, 5, 8);
camera.lookAt(0, 0, 0);

/* ---------- Controls ---------- */
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.target.set(0, 0.5, 0);

const transform = new TransformControls(camera, renderer.domElement);
transform.size = 1.1; // Blender風：少し大きめ

transform.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !e.value;
  if (!e.value) {
    // ドラッグ終了時の処理
    hideDragFeedback();
  }
});
transform.addEventListener("dragging", (_e) => {
  showDragFeedback();
  syncInspector();
});
transform.addEventListener("objectChange", () => {
  syncInspector();
});
scene.add(transform);

/* ---------- Shiftでスナップ ---------- */
let snapEnabled = false;
renderer.domElement.addEventListener("keydown", () => {
  // capture不要
});
function updateSnap() {
  // Shiftが押されている時だけスナップ
  transform.translationSnap = snapEnabled ? 0.25 : null;
  transform.rotationSnap = snapEnabled ? THREE.MathUtils.degToRad(15) : null;
  transform.scaleSnap = snapEnabled ? 0.25 : null;
}

/* ---------- ユーザーオブジェクト管理 ---------- */
const userGroup = new THREE.Group();
scene.add(userGroup);

let selected = null;
let counter = { cube: 0, sphere: 0, cylinder: 0, cone: 0, torus: 0, plane: 0, "point-light": 0 };

const ICONS = {
  cube: "▣",
  sphere: "●",
  cylinder: "⌭",
  cone: "▲",
  torus: "◯",
  plane: "▭",
  "point-light": "💡",
};

function nextName(type) {
  counter[type] = (counter[type] || 0) + 1;
  const t = type.replace("-", " ");
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return `${cap}.${String(counter[type] - 1).padStart(3, "0")}`;
}

function makeMaterial(color = 0x9ec5e8) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
}

function addObject(type) {
  let obj;
  let geo;
  switch (type) {
    case "cube":
      geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      obj = new THREE.Mesh(geo, makeMaterial());
      obj.position.y = 0.75;
      break;
    case "sphere":
      geo = new THREE.SphereGeometry(1, 32, 16);
      obj = new THREE.Mesh(geo, makeMaterial(0xe89a6f));
      obj.position.y = 1;
      break;
    case "cylinder":
      geo = new THREE.CylinderGeometry(0.8, 0.8, 2, 32);
      obj = new THREE.Mesh(geo, makeMaterial(0x9ae89a));
      obj.position.y = 1;
      break;
    case "cone":
      geo = new THREE.ConeGeometry(1, 2, 32);
      obj = new THREE.Mesh(geo, makeMaterial(0xe8c96f));
      obj.position.y = 1;
      break;
    case "torus":
      geo = new THREE.TorusGeometry(1, 0.35, 16, 60);
      obj = new THREE.Mesh(geo, makeMaterial(0xc09ae8));
      obj.position.y = 1;
      break;
    case "plane":
      geo = new THREE.PlaneGeometry(3, 3);
      obj = new THREE.Mesh(geo, makeMaterial(0xbfbfbf));
      obj.rotation.x = -Math.PI / 2;
      obj.position.y = 0.05;
      break;
    case "point-light": {
      const light = new THREE.PointLight(0xffe1a8, 50, 20, 2);
      light.position.set(2, 3, 2);
      light.castShadow = true;
      obj = light;
      const helper = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe1a8 })
      );
      helper.userData.helper = true;
      helper.userData.lightHelper = true;
      obj.add(helper);
      break;
    }
    default:
      return;
  }
  obj.castShadow = type !== "plane" && type !== "point-light";
  obj.receiveShadow = true;
  obj.name = nextName(type);
  obj.userData.type = type;
  obj.userData.baseColor = obj.material ? obj.material.color.getHex() : 0xffe1a8;
  userGroup.add(obj);
  syncHierarchy();
  select(obj);
}

/* ---------- 選択 ---------- */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let dragMoved = false;
let pointerDownPos = { x: 0, y: 0 };

canvas.addEventListener("pointerdown", (e) => {
  dragMoved = false;
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointermove", (e) => {
  if (Math.abs(e.clientX - pointerDownPos.x) + Math.abs(e.clientY - pointerDownPos.y) > 4) dragMoved = true;
});
canvas.addEventListener("pointerup", (e) => {
  if (dragMoved) return;
  if (e.button !== 0) return; // 左クリックのみ
  pickObject(e);
});

// ビューポート左下の . をダブルクリックで選択をfit
canvas.addEventListener("dblclick", (e) => {
  if (selected) frameObject(selected);
});

function pickObject(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const targets = userGroup.children.filter((c) => {
    if (c.userData.helper) return false;
    // ライトはヘルパー経由で選択
    return true;
  });
  const meshes = [];
  targets.forEach((o) => {
    if (o.isLight) {
      o.children.forEach((c) => { if (c.userData.lightHelper) meshes.push(c); });
    } else if (o.isMesh) {
      meshes.push(o);
    }
  });
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length > 0) {
    const top = hits[0].object;
    const obj = top.userData.lightHelper ? top.parent : top;
    select(obj);
  } else {
    select(null);
  }
}

function select(obj) {
  selected = obj;
  if (obj) {
    transform.attach(obj);
  } else {
    transform.detach();
  }
  syncHierarchy();
  syncInspector();
  updateHud();
}

/* ---------- Hierarchy ---------- */
const hierarchyEl = document.getElementById("hierarchy");

function syncHierarchy() {
  hierarchyEl.innerHTML = "";
  userGroup.children.forEach((obj) => {
    if (obj.userData.helper) return;
    const item = document.createElement("div");
    item.className = "tree-item" + (obj === selected ? " selected" : "");
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = ICONS[obj.userData.type] || "•";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = obj.name;
    const type = document.createElement("span");
    type.className = "type";
    type.textContent = obj.userData.type;
    item.append(icon, name, type);
    item.addEventListener("click", () => select(obj));
    item.addEventListener("dblclick", () => {
      orbit.target.copy(obj.position);
    });
    hierarchyEl.appendChild(item);
  });
  document.getElementById("hud-stats").textContent = `${userGroup.children.length} obj`;
}

/* ---------- Inspector ---------- */
const inspectorBody = document.getElementById("inspector-body");

function syncInspector() {
  if (!selected) {
    inspectorBody.innerHTML = '<div class="empty-hint">オブジェクトを選択してください</div>';
    return;
  }
  const o = selected;
  const isLight = o.isLight;

  const p = o.position;
  const r = o.rotation;
  const s = o.scale;

  let colorRow = "";
  if (o.material || isLight) {
    const col = isLight ? o.color.getHex() : o.material.color.getHex();
    colorRow = `
      <div class="row">
        <label>Color</label>
        <input type="color" id="insp-color" value="#${col.toString(16).padStart(6, "0")}" />
      </div>`;
  }
  let intensityRow = "";
  if (isLight) {
    intensityRow = `
      <div class="row">
        <label>Intensity</label>
        <input type="number" id="insp-intensity" step="0.1" value="${o.intensity}" />
      </div>`;
  }

  inspectorBody.innerHTML = `
    <div class="field-group">
      <div class="field-group-title">${o.name}</div>
      <div class="row">
        <label>Type</label>
        <span style="color:var(--text-dim)">${o.userData.type}</span>
      </div>
    </div>
    <div class="field-group">
      <div class="field-group-title">Transform</div>
      <div class="field-row">
        <label>Position</label>
        <input type="number" class="px" step="0.1" value="${p.x.toFixed(3)}" />
        <input type="number" class="py" step="0.1" value="${p.y.toFixed(3)}" />
        <input type="number" class="pz" step="0.1" value="${p.z.toFixed(3)}" />
      </div>
      <div class="field-row">
        <label>Rotation</label>
        <input type="number" class="rx" step="1" value="${THREE.MathUtils.radToDeg(r.x).toFixed(1)}" />
        <input type="number" class="ry" step="1" value="${THREE.MathUtils.radToDeg(r.y).toFixed(1)}" />
        <input type="number" class="rz" step="1" value="${THREE.MathUtils.radToDeg(r.z).toFixed(1)}" />
      </div>
      <div class="field-row">
        <label>Scale</label>
        <input type="number" class="sx" step="0.1" value="${s.x.toFixed(3)}" />
        <input type="number" class="sy" step="0.1" value="${s.y.toFixed(3)}" />
        <input type="number" class="sz" step="0.1" value="${s.z.toFixed(3)}" />
      </div>
    </div>
    <div class="field-group">
      <div class="field-group-title">Material / Light</div>
      ${colorRow}
      ${intensityRow}
    </div>
    <div class="field-group">
      <div class="field-group-title">Actions</div>
      <div class="row">
        <button class="action" id="insp-duplicate">Duplicate</button>
        <button class="action danger" id="insp-delete">Delete</button>
      </div>
    </div>
  `;

  // バインド
  const bind3 = (cls, onChange) => {
    document.querySelectorAll(cls).forEach((input, i) => {
      input.addEventListener("input", () => onChange(i, parseFloat(input.value) || 0));
    });
  };
  bind3(".px, .py, .pz", (i, v) => (selected.position.setComponent(i, v)));
  bind3(".rx, .ry, .rz", (i, v) => {
    selected.rotation.setComponent(i, THREE.MathUtils.degToRad(v));
  });
  bind3(".sx, .sy, .sz", (i, v) => (selected.scale.setComponent(i, Math.max(0.001, v))));

  const colorInput = document.getElementById("insp-color");
  if (colorInput) {
    colorInput.addEventListener("input", () => {
      const c = new THREE.Color(colorInput.value);
      if (selected.isLight) selected.color.copy(c);
      else selected.material.color.copy(c);
    });
  }
  const intensity = document.getElementById("insp-intensity");
  if (intensity) {
    intensity.addEventListener("input", () => {
      selected.intensity = parseFloat(intensity.value) || 0;
    });
  }
  document.getElementById("insp-delete").addEventListener("click", deleteSelected);
  document.getElementById("insp-duplicate").addEventListener("click", duplicateSelected);
}

function deleteSelected() {
  if (!selected) return;
  const next = selected === userGroup.children[0] ? null : selected;
  userGroup.remove(selected);
  selected.geometry?.dispose?.();
  if (selected.material) {
    if (Array.isArray(selected.material)) selected.material.forEach((m) => m.dispose());
    else selected.material.dispose();
  }
  select(null);
  syncHierarchy();
}

function duplicateSelected() {
  if (!selected) return;
  const o = selected;
  let clone;
  if (o.isMesh) {
    clone = new THREE.Mesh(o.geometry.clone(), o.material.clone());
  } else if (o.isLight) {
    clone = new o.constructor(o.color, o.intensity, o.distance, o.decay);
    clone.position.copy(o.position);
    if (o.userData.type === "point-light") {
      const helper = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 8),
        new THREE.MeshBasicMaterial({ color: o.color })
      );
      helper.userData.helper = true;
      helper.userData.lightHelper = true;
      clone.add(helper);
    }
  }
  clone.position.copy(o.position).add(new THREE.Vector3(0.6, 0, 0.6));
  clone.rotation.copy(o.rotation);
  clone.scale.copy(o.scale);
  clone.castShadow = o.castShadow;
  clone.receiveShadow = o.receiveShadow;
  clone.name = nextName(o.userData.type);
  clone.userData.type = o.userData.type;
  userGroup.add(clone);
  select(clone);
}

/* ---------- HUD ---------- */
function updateHud() {
  document.getElementById("hud-mode").textContent =
    transform.mode.charAt(0).toUpperCase() + transform.mode.slice(1);
  document.getElementById("hud-selection").textContent = selected ? selected.name : "—";
}

/* ---------- File メニュー ---------- */
document.querySelectorAll("#menu-file .item").forEach((it) => {
  it.addEventListener("click", () => {
    const a = it.dataset.action;
    if (!a) return;
    if (a === "export-glb") exportScene("glb", false);
    else if (a === "export-gltf") exportScene("gltf", false);
    else if (a === "export-glb-selected") exportScene("glb", true);
    else if (a === "clear-scene") clearScene();
  });
});
document.getElementById("menu-file").addEventListener("click", (e) => {
  if (e.target.classList.contains("item")) return;
  e.currentTarget.classList.toggle("open");
});

/* ---------- メニュー ---------- */
document.querySelectorAll("#menu-add .item").forEach((it) => {
  it.addEventListener("click", () => addObject(it.dataset.add));
});
document.querySelectorAll("#menu-view .item").forEach((it) => {
  it.addEventListener("click", () => setView(it.dataset.view));
});
document.getElementById("menu-add").addEventListener("click", (e) => {
  if (e.target.classList.contains("item")) return;
  e.currentTarget.classList.toggle("open");
});
document.getElementById("menu-view").addEventListener("click", (e) => {
  if (e.target.classList.contains("item")) return;
  e.currentTarget.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu")) {
    document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
  }
});

/* ---------- クリア ---------- */
function clearScene() {
  if (!confirm("シーンの全オブジェクトを削除しますか？")) return;
  const toRemove = userGroup.children.filter((o) => !o.userData.helper);
  select(null);
  toRemove.forEach((o) => {
    userGroup.remove(o);
    o.geometry?.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
    o.children?.forEach((c) => {
      if (c.userData.lightHelper) {
        c.geometry.dispose();
        c.material.dispose();
      }
    });
  });
  counter = { cube: 0, sphere: 0, cylinder: 0, cone: 0, torus: 0, plane: 0, "point-light": 0 };
  syncHierarchy();
}

/* ---------- エクスポート ---------- */
async function exportScene(format, onlySelected) {
  const hasIO = !!window.rentanaIO;
  // ライトヘルパーや補助オブジェクトを除外したクローンを作る
  const exportGroup = new THREE.Group();
  const roots = onlySelected && selected ? [selected] : userGroup.children.filter((o) => !o.userData.helper);
  roots.forEach((o) => {
    if (o.isLight && o.children.length) {
      // ライト本体（ヘルパーを除外してクローン）
      const lightClone = new o.constructor(o.color, o.intensity, o.distance, o.decay);
      lightClone.position.copy(o.position);
      lightClone.name = o.name;
      exportGroup.add(lightClone);
    } else if (o.isMesh) {
      // メッシュをクローン（共有ジオメトリOKだが安全にclone）
      const meshClone = new THREE.Mesh(o.geometry, o.material);
      meshClone.position.copy(o.position);
      meshClone.rotation.copy(o.rotation);
      meshClone.scale.copy(o.scale);
      meshClone.name = o.name;
      exportGroup.add(meshClone);
    }
  });
  if (exportGroup.children.length === 0) {
    flashStatus("オブジェクトがありません", true);
    return;
  }

  const exporter = new GLTFExporter();

  if (!hasIO) {
    // Webブラウザモード: ダウンロード
    if (format === "glb") {
      exporter.parse(
        exportGroup,
        (result) => {
          const blob = new Blob([result], { type: "model/gltf-binary" });
          downloadBlob(blob, `scene-${Date.now()}.glb`);
          flashStatus("GLB をダウンロードしました");
        },
        (err) => { flashStatus("エクスポート失敗: " + err, true); },
        { binary: true }
      );
    } else {
      exporter.parse(
        exportGroup,
        (result) => {
          const json = JSON.stringify(result, null, 2);
          const blob = new Blob([json], { type: "model/gltf+json" });
          downloadBlob(blob, `scene-${Date.now()}.gltf`);
          flashStatus("GLTF をダウンロードしました");
        },
        (err) => { flashStatus("エクスポート失敗: " + err, true); },
        { binary: false }
      );
    }
    return;
  }

  // Electronモード: ネイティブ保存ダイアログ
  const picked = await window.rentanaIO.pickExportPath();
  if (!picked.ok) { flashStatus("キャンセルしました"); return; }
  const filePath = picked.path;
  const isGlb = filePath.toLowerCase().endsWith(".glb");

  if (isGlb) {
    exporter.parse(
      exportGroup,
      async (result) => {
        // result は ArrayBuffer
        const ab = result instanceof ArrayBuffer ? result : (result.buffer || new ArrayBuffer(0));
        const res = await window.rentanaIO.writeBinary(filePath, ab);
        if (res.ok) flashStatus("保存しました: " + filePath);
        else flashStatus("保存失敗: " + res.error, true);
      },
      (err) => { flashStatus("エクスポート失敗: " + err, true); },
      { binary: true }
    );
  } else {
    exporter.parse(
      exportGroup,
      async (result) => {
        const json = JSON.stringify(result, null, 2);
        const res = await window.rentanaIO.writeText(filePath, json);
        if (res.ok) flashStatus("保存しました: " + filePath);
        else flashStatus("保存失敗: " + res.error, true);
      },
      (err) => { flashStatus("エクスポート失敗: " + err, true); },
      { binary: false }
    );
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flashStatus(msg, isError = false) {
  const el = document.getElementById("status-ready");
  el.textContent = msg;
  el.style.color = isError ? "#e88" : "var(--ok)";
  setTimeout(() => {
    el.textContent = "Ready";
    el.style.color = "";
  }, 4000);
}

function setView(view) {
  const d = 10;
  let pos;
  switch (view) {
    case "front": pos = new THREE.Vector3(0, 2, d); break;
    case "top": pos = new THREE.Vector3(0, d, 0.001); break;
    case "side": pos = new THREE.Vector3(d, 2, 0); break;
    case "reset":
    default:
      pos = new THREE.Vector3(7, 5, 8);
  }
  camera.position.copy(pos);
  orbit.target.set(0, 0.5, 0);
  orbit.update();
}

/* ---------- 選択オブジェクトをfit ---------- */
const _frameBox = new THREE.Box3();
const _frameSize = new THREE.Vector3();
const _frameCenter = new THREE.Vector3();
function frameObject(obj) {
  _frameBox.setFromObject(obj);
  if (_frameBox.isEmpty()) return;
  _frameBox.getSize(_frameSize);
  _frameBox.getCenter(_frameCenter);
  const maxDim = Math.max(_frameSize.x, _frameSize.y, _frameSize.z, 0.5);
  const fov = camera.fov * Math.PI / 180;
  let dist = (maxDim / 2) / Math.tan(fov / 2);
  dist *= 1.8;
  const dir = new THREE.Vector3(1, 0.7, 1).normalize();
  orbit.target.copy(_frameCenter);
  camera.position.copy(_frameCenter).add(dir.multiplyScalar(dist));
  orbit.update();
}

/* ---------- ドラッグ中の値フィードバック ---------- */
let dragStart = null;
let dragStartPos = new THREE.Vector3();
let dragStartRot = new THREE.Euler();
let dragStartScale = new THREE.Vector3();

renderer.domElement.addEventListener("pointerdown", () => {
  if (transform.dragging) {
    dragStart = { time: performance.now() };
  }
});
// TransformControls の dragging 開始を捉える
transform.addEventListener("dragging-changed", (e) => {
  if (e.value && selected) {
    dragStartPos.copy(selected.position);
    dragStartRot.copy(selected.rotation);
    dragStartScale.copy(selected.scale);
  }
});
transform.addEventListener("objectChange", () => {
  showDragFeedback();
});

const feedbackEl = document.getElementById("drag-feedback");
function showDragFeedback() {
  if (!selected || !transform.dragging) { hideDragFeedback(); return; }
  let txt = "";
  if (transform.mode === "translate") {
    const dx = selected.position.x - dragStartPos.x;
    const dy = selected.position.y - dragStartPos.y;
    const dz = selected.position.z - dragStartPos.z;
    txt = `Δpos (${dx.toFixed(2)}, ${dy.toFixed(2)}, ${dz.toFixed(2)})`;
  } else if (transform.mode === "rotate") {
    const dx = selected.rotation.x - dragStartRot.x;
    const dy = selected.rotation.y - dragStartRot.y;
    const dz = selected.rotation.z - dragStartRot.z;
    txt = `Δrot (${THREE.MathUtils.radToDeg(dx).toFixed(0)}°, ${THREE.MathUtils.radToDeg(dy).toFixed(0)}°, ${THREE.MathUtils.radToDeg(dz).toFixed(0)}°)`;
  } else if (transform.mode === "scale") {
    const dx = selected.scale.x / dragStartScale.x;
    const dy = selected.scale.y / dragStartScale.y;
    const dz = selected.scale.z / dragStartScale.z;
    txt = `×scale (${dx.toFixed(2)}, ${dy.toFixed(2)}, ${dz.toFixed(2)})`;
  }
  if (snapEnabled) txt += "  [SNAP]";
  feedbackEl.textContent = txt;
  feedbackEl.style.display = "block";
}
function hideDragFeedback() {
  feedbackEl.style.display = "none";
}

/* ---------- モード切替 ---------- */
document.querySelectorAll(".mode-switch button").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.mode));
});
function setMode(mode) {
  transform.setMode(mode);
  document.querySelectorAll(".mode-switch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  updateHud();
}

/* ---------- ショートカット ---------- */
const axisState = { axis: null };
window.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (e.key === "Shift") { snapEnabled = true; updateSnap(); }

  switch (e.key.toLowerCase()) {
    case "g": setMode("translate"); break;
    case "r": setMode("rotate"); break;
    case "s": setMode("scale"); break;
    case "x": setAxis("x"); break;
    case "y": setAxis("y"); break;
    case "z": setAxis("z"); break;
    case "delete":
    case "backspace": deleteSelected(); break;
    case "d": if (e.shiftKey || e.ctrlKey) { e.preventDefault(); duplicateSelected(); } break;
    case "f": if (selected) frameObject(selected); break;
    case "escape":
      if (axisState.axis) { setAxis(null); }
      else select(null);
      break;
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") { snapEnabled = false; updateSnap(); }
});

function setAxis(axis) {
  axisState.axis = axis;
  if (!axis) {
    transform.showX = transform.showY = transform.showZ = true;
  } else {
    transform.showX = axis === "x";
    transform.showY = axis === "y";
    transform.showZ = axis === "z";
  }
  axisState.axis = axis;
}

/* ---------- リサイズ ---------- */
function onResize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener("resize", onResize);

/* ---------- レンダーループ ---------- */
function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  // ライトヘルパーの色をライトに同期
  userGroup.children.forEach((o) => {
    if (o.isLight && o.children[0]) {
      o.children[0].material.color.copy(o.color);
    }
  });
  renderer.render(scene, camera);
}

/* ---------- 初期化 ---------- */
onResize();
addObject("cube");
syncHierarchy();
updateHud();
animate();