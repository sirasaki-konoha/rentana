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
transform.setSize(1.15);
transform.setSpace("world");

transform.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !e.value;
  if (!e.value) {
    hideDragFeedback();
    const labels = {
      translate: "Move Object",
      rotate: "Rotate Object",
      scale: "Scale Object",
    };
    commitHistory(labels[transform.mode] || "Transform Object");
  }
});
transform.addEventListener("objectChange", () => {
  syncInspector();
  markDirty();
});
// Three.js r170以降はControls本体ではなく描画用Helperをシーンへ追加する。
scene.add(transform.getHelper());

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
const SUPPORTED_TYPES = ["cube", "sphere", "cylinder", "cone", "torus", "plane", "point-light"];
const freshCounter = () => Object.fromEntries(SUPPORTED_TYPES.map((type) => [type, 0]));
let counter = freshCounter();
let currentProjectPath = null;
let currentProjectName = "Untitled.rentana";
let projectDirty = false;
let loadingProject = false;
const HISTORY_LIMIT = 100;
let undoStack = [];
let redoStack = [];
let currentHistorySnapshot = null;
let restoringHistory = false;

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

function createSceneObject(type) {
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
      return null;
  }
  obj.castShadow = type !== "plane";
  obj.receiveShadow = type !== "point-light";
  obj.userData.type = type;
  obj.userData.baseColor = obj.material ? obj.material.color.getHex() : 0xffe1a8;
  return obj;
}

function addObject(type) {
  const obj = createSceneObject(type);
  if (!obj) return;
  obj.name = nextName(type);
  userGroup.add(obj);
  markDirty();
  syncHierarchy();
  select(obj);
  commitHistory(`Add ${obj.name}`);
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
        <div class="axis-input x"><span>X</span><input aria-label="Position X" type="number" class="px" step="0.1" value="${p.x.toFixed(3)}" /></div>
        <div class="axis-input y"><span>Y</span><input aria-label="Position Y" type="number" class="py" step="0.1" value="${p.y.toFixed(3)}" /></div>
        <div class="axis-input z"><span>Z</span><input aria-label="Position Z" type="number" class="pz" step="0.1" value="${p.z.toFixed(3)}" /></div>
      </div>
      <div class="field-row">
        <label>Rotation</label>
        <div class="axis-input x"><span>X</span><input aria-label="Rotation X" type="number" class="rx" step="1" value="${THREE.MathUtils.radToDeg(r.x).toFixed(1)}" /></div>
        <div class="axis-input y"><span>Y</span><input aria-label="Rotation Y" type="number" class="ry" step="1" value="${THREE.MathUtils.radToDeg(r.y).toFixed(1)}" /></div>
        <div class="axis-input z"><span>Z</span><input aria-label="Rotation Z" type="number" class="rz" step="1" value="${THREE.MathUtils.radToDeg(r.z).toFixed(1)}" /></div>
      </div>
      <div class="field-row">
        <label>Scale</label>
        <div class="axis-input x"><span>X</span><input aria-label="Scale X" type="number" class="sx" step="0.1" value="${s.x.toFixed(3)}" /></div>
        <div class="axis-input y"><span>Y</span><input aria-label="Scale Y" type="number" class="sy" step="0.1" value="${s.y.toFixed(3)}" /></div>
        <div class="axis-input z"><span>Z</span><input aria-label="Scale Z" type="number" class="sz" step="0.1" value="${s.z.toFixed(3)}" /></div>
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
  const bind3 = (cls, onChange, historyLabel) => {
    document.querySelectorAll(cls).forEach((input, i) => {
      input.addEventListener("input", () => {
        const value = Number.parseFloat(input.value);
        if (!Number.isFinite(value)) return;
        onChange(i, value);
        markDirty();
      });
      input.addEventListener("change", () => commitHistory(historyLabel));
    });
  };
  bind3(".px, .py, .pz", (i, v) => (selected.position.setComponent(i, v)), "Change Position");
  bind3(".rx, .ry, .rz", (i, v) => {
    selected.rotation.setComponent(i, THREE.MathUtils.degToRad(v));
  }, "Change Rotation");
  bind3(".sx, .sy, .sz", (i, v) => {
    const nonZeroValue = Math.abs(v) < 0.001 ? (v < 0 ? -0.001 : 0.001) : v;
    selected.scale.setComponent(i, nonZeroValue);
  }, "Change Scale");

  const colorInput = document.getElementById("insp-color");
  if (colorInput) {
    colorInput.addEventListener("input", () => {
      const c = new THREE.Color(colorInput.value);
      if (selected.isLight) selected.color.copy(c);
      else selected.material.color.copy(c);
      markDirty();
    });
    colorInput.addEventListener("change", () => commitHistory("Change Color"));
  }
  const intensity = document.getElementById("insp-intensity");
  if (intensity) {
    intensity.addEventListener("input", () => {
      selected.intensity = parseFloat(intensity.value) || 0;
      markDirty();
    });
    intensity.addEventListener("change", () => commitHistory("Change Light Intensity"));
  }
  document.getElementById("insp-delete").addEventListener("click", deleteSelected);
  document.getElementById("insp-duplicate").addEventListener("click", duplicateSelected);
}

function deleteSelected() {
  if (!selected) return;
  const objectToDelete = selected;
  userGroup.remove(objectToDelete);
  disposeObject(objectToDelete);
  select(null);
  markDirty();
  syncHierarchy();
  commitHistory(`Delete ${objectToDelete.name}`);
}

function disposeObject(obj) {
  obj.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material?.dispose?.();
  });
}

function clearUserObjects() {
  select(null);
  [...userGroup.children].forEach((obj) => {
    userGroup.remove(obj);
    disposeObject(obj);
  });
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
  clone.userData = { ...o.userData };
  userGroup.add(clone);
  markDirty();
  select(clone);
  commitHistory(`Duplicate ${o.name}`);
}

/* ---------- HUD ---------- */
function updateHud() {
  document.getElementById("hud-mode").textContent =
    transform.mode.charAt(0).toUpperCase() + transform.mode.slice(1);
  document.getElementById("hud-selection").textContent = selected ? selected.name : "—";
}

/* ---------- Rentana プロジェクト ---------- */
const RENTANA_FORMAT = "rentana-project";
const RENTANA_VERSION = 1;

function markDirty() {
  if (loadingProject || projectDirty) return;
  projectDirty = true;
  updateProjectStatus();
}

function updateProjectStatus() {
  const prefix = projectDirty ? "● " : "";
  document.getElementById("project-status").textContent = `${prefix}${currentProjectName}`;
  document.title = `${projectDirty ? "* " : ""}${currentProjectName} — Rentana`;
}

function serializeObject(obj) {
  const data = {
    id: obj.uuid,
    type: obj.userData.type,
    name: obj.name,
    transform: {
      position: obj.position.toArray(),
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order],
      scale: obj.scale.toArray(),
    },
    visible: obj.visible,
    castShadow: obj.castShadow,
    receiveShadow: obj.receiveShadow,
  };

  if (obj.isMesh && obj.material) {
    data.material = {
      color: obj.material.color.getHex(),
      roughness: obj.material.roughness,
      metalness: obj.material.metalness,
      opacity: obj.material.opacity,
      transparent: obj.material.transparent,
    };
  } else if (obj.isPointLight) {
    data.light = {
      color: obj.color.getHex(),
      intensity: obj.intensity,
      distance: obj.distance,
      decay: obj.decay,
    };
  }
  return data;
}

function createProjectData() {
  return {
    format: RENTANA_FORMAT,
    version: RENTANA_VERSION,
    generator: "Rentana 1.0.0",
    savedAt: new Date().toISOString(),
    scene: {
      background: scene.background.getHex(),
      objects: userGroup.children.map(serializeObject),
    },
    editor: {
      camera: {
        position: camera.position.toArray(),
        target: orbit.target.toArray(),
        fov: camera.fov,
      },
      transform: {
        mode: transform.mode,
        space: transform.space,
      },
      selectedObjectId: selected?.uuid || null,
      counters: { ...counter },
    },
  };
}

function validVector(value, length, fallback) {
  if (!Array.isArray(value) || value.length < length) return fallback;
  const result = value.slice(0, length).map(Number);
  return result.every(Number.isFinite) ? result : fallback;
}

function restoreObject(data) {
  if (!data || !SUPPORTED_TYPES.includes(data.type)) return null;
  const obj = createSceneObject(data.type);
  if (!obj) return null;

  if (typeof data.id === "string" && data.id.length > 0) obj.uuid = data.id;
  if (typeof data.name === "string" && data.name.trim()) obj.name = data.name;
  else obj.name = nextName(data.type);

  const position = validVector(data.transform?.position, 3, [0, 0, 0]);
  const rotation = validVector(data.transform?.rotation, 3, [0, 0, 0]);
  const scale = validVector(data.transform?.scale, 3, [1, 1, 1]);
  const order = ["XYZ", "YZX", "ZXY", "XZY", "YXZ", "ZYX"].includes(data.transform?.rotation?.[3])
    ? data.transform.rotation[3]
    : THREE.Euler.DEFAULT_ORDER;
  obj.position.fromArray(position);
  obj.rotation.set(rotation[0], rotation[1], rotation[2], order);
  obj.scale.set(...scale.map((value) => (
    Math.abs(value) < 0.001 ? (value < 0 ? -0.001 : 0.001) : value
  )));
  obj.visible = data.visible !== false;
  obj.castShadow = Boolean(data.castShadow);
  obj.receiveShadow = Boolean(data.receiveShadow);

  if (obj.isMesh && data.material) {
    if (Number.isInteger(data.material.color)) obj.material.color.setHex(data.material.color);
    if (Number.isFinite(data.material.roughness)) obj.material.roughness = data.material.roughness;
    if (Number.isFinite(data.material.metalness)) obj.material.metalness = data.material.metalness;
    if (Number.isFinite(data.material.opacity)) obj.material.opacity = data.material.opacity;
    obj.material.transparent = Boolean(data.material.transparent);
  } else if (obj.isPointLight && data.light) {
    if (Number.isInteger(data.light.color)) obj.color.setHex(data.light.color);
    if (Number.isFinite(data.light.intensity)) obj.intensity = data.light.intensity;
    if (Number.isFinite(data.light.distance)) obj.distance = data.light.distance;
    if (Number.isFinite(data.light.decay)) obj.decay = data.light.decay;
  }

  userGroup.add(obj);
  return obj;
}

function rebuildCounters(savedCounters) {
  counter = freshCounter();
  if (savedCounters && typeof savedCounters === "object") {
    SUPPORTED_TYPES.forEach((type) => {
      const value = Number(savedCounters[type]);
      if (Number.isInteger(value) && value >= 0) counter[type] = value;
    });
  }
  userGroup.children.forEach((obj) => {
    const match = obj.name.match(/\.(\d+)$/);
    if (match) counter[obj.userData.type] = Math.max(counter[obj.userData.type], Number(match[1]) + 1);
  });
}

/* ---------- Undo / Redo ---------- */
function captureHistorySnapshot() {
  return JSON.stringify({
    scene: {
      background: scene.background.getHex(),
      objects: userGroup.children.map(serializeObject),
    },
    selectedObjectId: selected?.uuid || null,
    counters: { ...counter },
  });
}

function updateHistoryMenu() {
  document.querySelector('[data-history="undo"]')?.classList.toggle("disabled", undoStack.length === 0);
  document.querySelector('[data-history="redo"]')?.classList.toggle("disabled", redoStack.length === 0);
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  currentHistorySnapshot = captureHistorySnapshot();
  updateHistoryMenu();
}

function commitHistory(label) {
  if (loadingProject || restoringHistory) return;
  const nextSnapshot = captureHistorySnapshot();
  if (currentHistorySnapshot === null) {
    currentHistorySnapshot = nextSnapshot;
    updateHistoryMenu();
    return;
  }
  if (nextSnapshot === currentHistorySnapshot) return;

  undoStack.push({ snapshot: currentHistorySnapshot, label });
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  currentHistorySnapshot = nextSnapshot;
  redoStack = [];
  updateHistoryMenu();
}

function restoreHistorySnapshot(snapshot) {
  const state = JSON.parse(snapshot);
  const wasLoadingProject = loadingProject;
  restoringHistory = true;
  loadingProject = true;
  try {
    clearUserObjects();
    const restored = state.scene.objects.map(restoreObject).filter(Boolean);
    if (Number.isInteger(state.scene.background)) scene.background.setHex(state.scene.background);
    rebuildCounters(state.counters);
    select(restored.find((obj) => obj.uuid === state.selectedObjectId) || null);
    syncHierarchy();
  } finally {
    loadingProject = wasLoadingProject;
    restoringHistory = false;
  }
}

function undoHistory() {
  if (undoStack.length === 0) {
    flashStatus("Undoできる操作がありません");
    return;
  }
  const entry = undoStack.pop();
  redoStack.push({ snapshot: currentHistorySnapshot, label: entry.label });
  restoreHistorySnapshot(entry.snapshot);
  currentHistorySnapshot = entry.snapshot;
  markDirty();
  updateHistoryMenu();
  flashStatus(`Undo: ${entry.label}`);
}

function redoHistory() {
  if (redoStack.length === 0) {
    flashStatus("Redoできる操作がありません");
    return;
  }
  const entry = redoStack.pop();
  undoStack.push({ snapshot: currentHistorySnapshot, label: entry.label });
  restoreHistorySnapshot(entry.snapshot);
  currentHistorySnapshot = entry.snapshot;
  markDirty();
  updateHistoryMenu();
  flashStatus(`Redo: ${entry.label}`);
}

function loadProjectText(text, source = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSONとして読み取れません");
  }
  if (data?.format !== RENTANA_FORMAT) {
    throw new Error("Rentanaプロジェクトではありません");
  }
  if (data.version !== RENTANA_VERSION) {
    throw new Error(`未対応のRentana形式です (version ${data.version ?? "不明"})`);
  }
  if (!Array.isArray(data.scene?.objects)) {
    throw new Error("シーンデータが壊れています");
  }

  loadingProject = true;
  try {
    clearUserObjects();
    const restored = data.scene.objects.map(restoreObject).filter(Boolean);
    if (Number.isInteger(data.scene.background)) scene.background.setHex(data.scene.background);
    rebuildCounters(data.editor?.counters);

    const cameraPosition = validVector(data.editor?.camera?.position, 3, [7, 5, 8]);
    const cameraTarget = validVector(data.editor?.camera?.target, 3, [0, 0.5, 0]);
    camera.position.fromArray(cameraPosition);
    orbit.target.fromArray(cameraTarget);
    if (Number.isFinite(data.editor?.camera?.fov)) {
      camera.fov = THREE.MathUtils.clamp(data.editor.camera.fov, 10, 120);
      camera.updateProjectionMatrix();
    }
    orbit.update();

    setMode(["translate", "rotate", "scale"].includes(data.editor?.transform?.mode)
      ? data.editor.transform.mode
      : "translate");
    setTransformSpace(data.editor?.transform?.space === "local" ? "local" : "world");
    setAxis(null);
    select(restored.find((obj) => obj.uuid === data.editor?.selectedObjectId) || null);
    currentProjectPath = source.path || null;
    currentProjectName = source.name || source.path?.split(/[\\/]/).pop() || "Untitled.rentana";
    projectDirty = false;
    syncHierarchy();
    updateProjectStatus();
  } finally {
    loadingProject = false;
  }
  resetHistory();
}

async function saveProject(saveAs = false) {
  try {
    const json = JSON.stringify(createProjectData(), null, 2);
    if (window.rentanaIO) {
      let filePath = !saveAs ? currentProjectPath : null;
      if (!filePath) {
        const picked = await window.rentanaIO.saveFile({
          title: "Rentanaプロジェクトを保存",
          defaultPath: currentProjectName,
          filters: [{ name: "Rentana Project", extensions: ["rentana"] }],
        });
        if (!picked.ok) {
          if (!picked.canceled) flashStatus(`保存失敗: ${picked.error || "パスを選択できません"}`, true);
          return;
        }
        filePath = picked.path.toLowerCase().endsWith(".rentana") ? picked.path : `${picked.path}.rentana`;
      }
      const result = await window.rentanaIO.writeText(filePath, json);
      if (!result.ok) {
        flashStatus(`保存失敗: ${result.error}`, true);
        return;
      }
      currentProjectPath = filePath;
      currentProjectName = filePath.split(/[\\/]/).pop();
    } else {
      const filename = currentProjectName.toLowerCase().endsWith(".rentana")
        ? currentProjectName
        : `${currentProjectName}.rentana`;
      downloadBlob(new Blob([json], { type: "application/vnd.rentana.project+json" }), filename);
      currentProjectName = filename;
    }
    projectDirty = false;
    updateProjectStatus();
    flashStatus(`保存しました: ${currentProjectName}`);
  } catch (error) {
    flashStatus(`保存失敗: ${error.message}`, true);
  }
}

async function openProject() {
  if (projectDirty && !confirm("未保存の変更があります。保存せずに別のプロジェクトを開きますか？")) return;
  try {
    if (window.rentanaIO) {
      const result = await window.rentanaIO.openProject();
      if (!result.ok) {
        if (!result.canceled) flashStatus(`読み込み失敗: ${result.error}`, true);
        return;
      }
      loadProjectText(result.text, { path: result.path });
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".rentana,application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          loadProjectText(await file.text(), { name: file.name });
          flashStatus(`開きました: ${file.name}`);
        } catch (error) {
          flashStatus(`読み込み失敗: ${error.message}`, true);
        }
      }, { once: true });
      input.click();
      return;
    }
    flashStatus(`開きました: ${currentProjectName}`);
  } catch (error) {
    flashStatus(`読み込み失敗: ${error.message}`, true);
  }
}

function newProject() {
  if (projectDirty && !confirm("未保存の変更があります。新規プロジェクトを作成しますか？")) return;
  loadingProject = true;
  try {
    clearUserObjects();
    counter = freshCounter();
    const cube = createSceneObject("cube");
    cube.name = nextName("cube");
    userGroup.add(cube);
    setView("reset");
    setMode("translate");
    setTransformSpace("world");
    setAxis(null);
    select(cube);
    currentProjectPath = null;
    currentProjectName = "Untitled.rentana";
    projectDirty = false;
    updateProjectStatus();
  } finally {
    loadingProject = false;
  }
  resetHistory();
  flashStatus("新規プロジェクトを作成しました");
}

/* ---------- File メニュー ---------- */
document.querySelectorAll("#menu-file .item").forEach((it) => {
  it.addEventListener("click", () => {
    const a = it.dataset.action;
    if (!a) return;
    if (a === "new-project") newProject();
    else if (a === "open-project") openProject();
    else if (a === "save-project") saveProject(false);
    else if (a === "save-project-as") saveProject(true);
    else if (a === "export-glb") exportScene("glb", false);
    else if (a === "export-gltf") exportScene("gltf", false);
    else if (a === "export-glb-selected") exportScene("glb", true);
    else if (a === "clear-scene") clearScene();
    document.getElementById("menu-file").classList.remove("open");
  });
});
document.getElementById("menu-file").addEventListener("click", (e) => {
  if (e.target.closest(".item")) return;
  e.currentTarget.classList.toggle("open");
});

/* ---------- メニュー ---------- */
document.querySelectorAll("#menu-edit [data-history]").forEach((item) => {
  item.addEventListener("click", () => {
    if (item.dataset.history === "undo") undoHistory();
    else redoHistory();
    document.getElementById("menu-edit").classList.remove("open");
  });
});
document.getElementById("menu-edit").addEventListener("click", (e) => {
  if (e.target.closest(".item")) return;
  e.currentTarget.classList.toggle("open");
});
document.querySelectorAll("#menu-add .item").forEach((it) => {
  it.addEventListener("click", () => {
    addObject(it.dataset.add);
    document.getElementById("menu-add").classList.remove("open");
  });
});
document.querySelectorAll("#menu-view .item").forEach((it) => {
  it.addEventListener("click", () => {
    setView(it.dataset.view);
    document.getElementById("menu-view").classList.remove("open");
  });
});
document.getElementById("menu-add").addEventListener("click", (e) => {
  if (e.target.closest(".item")) return;
  e.currentTarget.classList.toggle("open");
});
document.getElementById("menu-view").addEventListener("click", (e) => {
  if (e.target.closest(".item")) return;
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
  clearUserObjects();
  counter = freshCounter();
  markDirty();
  commitHistory("Clear Scene");
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
  markDirty();
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
  markDirty();
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
  markDirty();
}

document.querySelectorAll(".space-switch button").forEach((button) => {
  button.addEventListener("click", () => setTransformSpace(button.dataset.space));
});
function setTransformSpace(space) {
  transform.setSpace(space);
  document.querySelectorAll(".space-switch button").forEach((button) => {
    button.classList.toggle("active", button.dataset.space === space);
  });
  markDirty();
}

/* ---------- ショートカット ---------- */
const axisState = { axis: null };
window.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  const commandKey = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (commandKey && (key === "z" || key === "y")) {
    e.preventDefault();
    if (tag === "INPUT" || tag === "TEXTAREA") commitHistory("Change Property");
    if (key === "y" || (key === "z" && e.shiftKey)) redoHistory();
    else undoHistory();
    return;
  }

  if (commandKey && ["n", "o", "s"].includes(key)) {
    e.preventDefault();
    if (tag === "INPUT" || tag === "TEXTAREA") commitHistory("Change Property");
    if (key === "n") newProject();
    else if (key === "o") openProject();
    else saveProject(e.shiftKey);
    return;
  }

  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (e.key === "Shift") { snapEnabled = true; updateSnap(); }

  switch (key) {
    case "w":
    case "g": setMode("translate"); break;
    case "e": setMode("rotate"); break;
    case "r":
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
window.addEventListener("blur", () => {
  snapEnabled = false;
  updateSnap();
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
orbit.addEventListener("end", markDirty);

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
projectDirty = false;
updateProjectStatus();
resetHistory();
animate();
