import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { decodeTextureDataUrl, exportFBX } from "./fbx-exporter.js";

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
  if (e.value) transformPointerActive = true;
  if (e.value && editMode) {
    beginVertexTransform();
  } else if (!e.value) {
    if (editMode) finishVertexTransform();
    hideDragFeedback();
    const labels = editMode
      ? {
          translate: "Move Vertices",
          rotate: "Rotate Vertices",
          scale: "Scale Vertices",
        }
      : {
          translate: "Move Object",
          rotate: "Rotate Object",
          scale: "Scale Object",
    };
    commitHistory(labels[transform.mode] || "Transform Object");
    setTimeout(() => { transformPointerActive = false; }, 0);
  }
});
transform.addEventListener("objectChange", () => {
  if (editMode && transform.object === editPivot) applyVertexTransform();
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
const editPivot = new THREE.Object3D();
editPivot.name = "Edit Pivot";
editPivot.visible = false;
editPivot.userData.helper = true;
scene.add(editPivot);

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
let editMode = false;
let editMesh = null;
let vertexPoints = null;
let vertexGroups = [];
let selectedVertexIndices = new Set();
let vertexTransformStart = null;
let transformPointerActive = false;

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

function normalizeTextureData(textureData) {
  if (!textureData || typeof textureData.dataUrl !== "string") return null;
  const decoded = decodeTextureDataUrl(textureData.dataUrl);
  return {
    name: typeof textureData.name === "string" && textureData.name.trim()
      ? textureData.name
      : `texture.${decoded.mimeType === "image/jpeg" ? "jpg" : "png"}`,
    mimeType: decoded.mimeType,
    dataUrl: textureData.dataUrl,
  };
}

function applyTextureData(obj, textureData, { showError = true } = {}) {
  if (!obj?.isMesh || !obj.material) return false;
  let normalized;
  try {
    normalized = normalizeTextureData(textureData);
  } catch (error) {
    if (showError) flashStatus(`テクスチャ読み込み失敗: ${error.message}`, true);
    return false;
  }
  if (!normalized) return false;

  const previousTexture = obj.material.map;
  const texture = new THREE.TextureLoader().load(
    normalized.dataUrl,
    undefined,
    undefined,
    () => {
      if (showError) flashStatus(`テクスチャ画像を読み込めません: ${normalized.name}`, true);
    }
  );
  texture.name = normalized.name;
  texture.colorSpace = THREE.SRGBColorSpace;
  obj.material.map = texture;
  obj.material.needsUpdate = true;
  obj.userData.texture = normalized;
  if (previousTexture && previousTexture !== texture) previousTexture.dispose();
  return true;
}

function removeTexture(obj) {
  if (!obj?.isMesh || !obj.material) return;
  obj.material.map?.dispose();
  obj.material.map = null;
  obj.material.needsUpdate = true;
  delete obj.userData.texture;
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("ファイルを読み込めません")), { once: true });
    reader.readAsDataURL(file);
  });
}

async function chooseTexture(target) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/bmp,image/gif,image/webp";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) {
      flashStatus("テクスチャは32MB以下の画像を選択してください", true);
      return;
    }
    try {
      const dataUrl = await fileAsDataUrl(file);
      if (!applyTextureData(target, {
        name: file.name,
        mimeType: file.type,
        dataUrl,
      })) return;
      markDirty();
      if (selected === target) syncInspector();
      commitHistory(`Set Texture: ${file.name}`);
      flashStatus(`テクスチャを設定しました: ${file.name}`);
    } catch (error) {
      flashStatus(`テクスチャ読み込み失敗: ${error.message}`, true);
    }
  }, { once: true });
  input.click();
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
  if (editMode) exitEditMode();
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
  if (dragMoved || transformPointerActive) return;
  if (e.button !== 0) return; // 左クリックのみ
  pickObject(e);
});

// ビューポート左下の . をダブルクリックで選択をfit
canvas.addEventListener("dblclick", (e) => {
  if (selected) frameObject(selected);
});

function pickObject(e) {
  if (editMode) {
    pickEditVertex(e);
    return;
  }
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
  if (editMode && obj !== editMesh) exitEditMode({ attachObject: false });
  selected = obj;
  if (editMode && obj === editMesh) {
    updateEditPivot();
  } else if (obj) {
    transform.attach(obj);
  } else {
    transform.detach();
  }
  syncHierarchy();
  syncInspector();
  updateHud();
}

/* ---------- Edit Mode / Vertex Select ---------- */
function buildVertexGroups(mesh) {
  const attribute = mesh.geometry.getAttribute("position");
  const groupsByPosition = new Map();
  const groups = [];
  for (let i = 0; i < attribute.count; i += 1) {
    const position = new THREE.Vector3().fromBufferAttribute(attribute, i);
    const key = `${Math.round(position.x * 100000)},${Math.round(position.y * 100000)},${Math.round(position.z * 100000)}`;
    let group = groupsByPosition.get(key);
    if (!group) {
      group = { position, indices: [] };
      groupsByPosition.set(key, group);
      groups.push(group);
    }
    group.indices.push(i);
  }
  return groups;
}

function createVertexPoints() {
  const positions = new Float32Array(vertexGroups.length * 3);
  const colors = new Float32Array(vertexGroups.length * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 8,
    sizeAttenuation: false,
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "Vertex Handles";
  points.renderOrder = 1000;
  points.frustumCulled = false;
  points.userData.helper = true;
  return points;
}

function refreshVertexPoints() {
  if (!vertexPoints) return;
  const positionAttribute = vertexPoints.geometry.getAttribute("position");
  const colorAttribute = vertexPoints.geometry.getAttribute("color");
  vertexGroups.forEach((group, index) => {
    positionAttribute.setXYZ(index, group.position.x, group.position.y, group.position.z);
    if (selectedVertexIndices.has(index)) colorAttribute.setXYZ(index, 1, 0.62, 0.12);
    else colorAttribute.setXYZ(index, 0.78, 0.84, 0.92);
  });
  positionAttribute.needsUpdate = true;
  colorAttribute.needsUpdate = true;
  vertexPoints.geometry.computeBoundingSphere();
  const count = document.getElementById("vertex-selection-count");
  if (count) count.textContent = `${selectedVertexIndices.size} / ${vertexGroups.length}`;
}

function updateEditModeUI() {
  const toggle = document.getElementById("editor-mode-toggle");
  document.getElementById("editor-mode-label").textContent = editMode ? "Edit Mode" : "Object Mode";
  toggle.classList.toggle("editing", editMode);
  document.getElementById("edit-tools").hidden = !editMode;
  const hint = document.getElementById("viewport-hint");
  if (editMode) {
    hint.innerHTML =
      "頂点をクリック: 選択 / Shift+クリック: 複数選択 / A: 全選択 / Alt+A: 選択解除<br/>" +
      "W E R: 移動・回転・拡縮 / Tab: Object Mode / Ctrl+Z・Ctrl+Y: Undo・Redo";
  } else {
    hint.innerHTML =
      "左ドラッグ: 回転 / 右ドラッグ: 視点移動 / ホイール: ズーム / ホイール押下: 視点移動<br/>" +
      "クリック: 選択 / W E R: 移動・回転・拡縮 / Tab: Edit Mode / Ctrl+Z・Ctrl+Y: Undo・Redo";
  }
}

function enterEditMode() {
  if (editMode) return;
  if (!selected?.isMesh || !selected.geometry?.getAttribute("position")) {
    flashStatus("Edit Modeはメッシュオブジェクトで使用できます", true);
    return;
  }
  editMode = true;
  editMesh = selected;
  selectedVertexIndices = new Set();
  vertexGroups = buildVertexGroups(editMesh);
  vertexPoints = createVertexPoints();
  editMesh.add(vertexPoints);
  transform.detach();
  setAxis(null);
  refreshVertexPoints();
  updateEditModeUI();
  syncHierarchy();
  syncInspector();
  updateHud();
  flashStatus("Edit Mode: 頂点を選択してください");
}

function exitEditMode({ attachObject = true } = {}) {
  if (!editMode) return;
  transform.detach();
  vertexTransformStart = null;
  if (vertexPoints && editMesh) {
    editMesh.remove(vertexPoints);
    vertexPoints.geometry.dispose();
    vertexPoints.material.dispose();
  }
  vertexPoints = null;
  vertexGroups = [];
  selectedVertexIndices.clear();
  editPivot.visible = false;
  editMode = false;
  editMesh = null;
  setAxis(null);
  if (attachObject && selected) transform.attach(selected);
  updateEditModeUI();
  syncHierarchy();
  syncInspector();
  updateHud();
}

function toggleEditMode() {
  if (editMode) exitEditMode();
  else enterEditMode();
}

function pickEditVertex(event) {
  if (!editMesh || transform.dragging) return;
  const rect = canvas.getBoundingClientRect();
  editMesh.updateMatrixWorld(true);
  let closestIndex = -1;
  let closestDistance = 14;
  const worldPosition = new THREE.Vector3();
  const projected = new THREE.Vector3();

  vertexGroups.forEach((group, index) => {
    worldPosition.copy(group.position).applyMatrix4(editMesh.matrixWorld);
    projected.copy(worldPosition).project(camera);
    if (projected.z < -1 || projected.z > 1) return;
    const screenX = rect.left + (projected.x + 1) * rect.width * 0.5;
    const screenY = rect.top + (1 - projected.y) * rect.height * 0.5;
    const distance = Math.hypot(event.clientX - screenX, event.clientY - screenY);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  if (closestIndex >= 0) {
    if (event.shiftKey) {
      if (selectedVertexIndices.has(closestIndex)) selectedVertexIndices.delete(closestIndex);
      else selectedVertexIndices.add(closestIndex);
    } else {
      selectedVertexIndices = new Set([closestIndex]);
    }
  } else if (!event.shiftKey) {
    selectedVertexIndices.clear();
  }
  refreshVertexPoints();
  updateEditPivot();
  syncInspector();
  updateHud();
}

function selectAllVertices() {
  if (!editMode) return;
  selectedVertexIndices = new Set(vertexGroups.map((_group, index) => index));
  refreshVertexPoints();
  updateEditPivot();
  syncInspector();
  updateHud();
}

function deselectAllVertices() {
  if (!editMode) return;
  selectedVertexIndices.clear();
  refreshVertexPoints();
  updateEditPivot();
  syncInspector();
  updateHud();
}

function updateEditPivot() {
  if (!editMode || !editMesh || selectedVertexIndices.size === 0) {
    transform.detach();
    editPivot.visible = false;
    return;
  }
  editMesh.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();
  selectedVertexIndices.forEach((index) => {
    worldPosition.copy(vertexGroups[index].position).applyMatrix4(editMesh.matrixWorld);
    center.add(worldPosition);
  });
  center.multiplyScalar(1 / selectedVertexIndices.size);
  editPivot.position.copy(center);
  editMesh.getWorldQuaternion(editPivot.quaternion);
  editPivot.scale.set(1, 1, 1);
  editPivot.visible = true;
  editPivot.updateMatrixWorld(true);
  transform.attach(editPivot);
}

function beginVertexTransform() {
  if (!editMode || !editMesh || selectedVertexIndices.size === 0) return;
  editMesh.updateMatrixWorld(true);
  editPivot.updateMatrixWorld(true);
  const worldPositions = new Map();
  selectedVertexIndices.forEach((index) => {
    worldPositions.set(
      index,
      vertexGroups[index].position.clone().applyMatrix4(editMesh.matrixWorld)
    );
  });
  vertexTransformStart = {
    pivotMatrix: editPivot.matrixWorld.clone(),
    meshWorldInverse: editMesh.matrixWorld.clone().invert(),
    worldPositions,
  };
}

function writeVertexGroup(group, position) {
  const attribute = editMesh.geometry.getAttribute("position");
  group.position.copy(position);
  group.indices.forEach((index) => attribute.setXYZ(index, position.x, position.y, position.z));
}

function updateEditedGeometry() {
  const geometry = editMesh.geometry;
  geometry.getAttribute("position").needsUpdate = true;
  geometry.computeVertexNormals();
  const normalAttribute = geometry.getAttribute("normal");
  if (normalAttribute) normalAttribute.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  editMesh.userData.geometryEdited = true;
  refreshVertexPoints();
}

function applyVertexTransform() {
  if (!vertexTransformStart || !editMesh) return;
  editPivot.updateMatrixWorld(true);
  const deltaMatrix = editPivot.matrixWorld
    .clone()
    .multiply(vertexTransformStart.pivotMatrix.clone().invert());
  vertexTransformStart.worldPositions.forEach((startWorldPosition, index) => {
    const localPosition = startWorldPosition
      .clone()
      .applyMatrix4(deltaMatrix)
      .applyMatrix4(vertexTransformStart.meshWorldInverse);
    writeVertexGroup(vertexGroups[index], localPosition);
  });
  updateEditedGeometry();
}

function finishVertexTransform() {
  if (!vertexTransformStart) return;
  applyVertexTransform();
  vertexTransformStart = null;
  updateEditPivot();
  syncInspector();
}

/* ---------- Hierarchy ---------- */
const hierarchyEl = document.getElementById("hierarchy");

function syncHierarchy() {
  hierarchyEl.innerHTML = "";
  userGroup.children.forEach((obj) => {
    if (obj.userData.helper) return;
    const item = document.createElement("div");
    item.className =
      "tree-item" +
      (obj === selected ? " selected" : "") +
      (editMode && obj === editMesh ? " editing" : "");
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function syncInspector() {
  if (editMode) {
    syncEditInspector();
    return;
  }
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
  let textureRows = "";
  if (o.isMesh) {
    const textureName = escapeHtml(o.userData.texture?.name || "なし");
    textureRows = `
      <div class="row texture-row">
        <label>Texture</label>
        <span class="texture-name" title="${textureName}">${textureName}</span>
      </div>
      <div class="row texture-actions">
        <button class="action" id="insp-texture-choose">画像を選択…</button>
        ${o.userData.texture
          ? '<button class="action danger" id="insp-texture-remove">解除</button>'
          : ""}
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
      ${textureRows}
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
  document.getElementById("insp-texture-choose")?.addEventListener("click", () => {
    chooseTexture(o);
  });
  document.getElementById("insp-texture-remove")?.addEventListener("click", () => {
    removeTexture(o);
    markDirty();
    syncInspector();
    commitHistory("Remove Texture");
    flashStatus("テクスチャを解除しました");
  });
  document.getElementById("insp-delete").addEventListener("click", deleteSelected);
  document.getElementById("insp-duplicate").addEventListener("click", duplicateSelected);
}

function syncEditInspector() {
  const selectedCount = selectedVertexIndices.size;
  const pivot = selectedCount > 0 ? editPivot.position : null;
  inspectorBody.innerHTML = `
    <div class="field-group">
      <div class="field-group-title">Edit Mode · Vertex Select</div>
      <div class="row">
        <label>Object</label>
        <span>${editMesh?.name || "—"}</span>
      </div>
      <div class="row">
        <label>Selected</label>
        <span>${selectedCount} / ${vertexGroups.length}</span>
      </div>
    </div>
    <div class="field-group">
      <div class="field-group-title">Selection</div>
      <div class="row">
        <button class="action" id="vertex-select-all">Select All</button>
        <button class="action" id="vertex-select-none">Deselect</button>
      </div>
    </div>
    <div class="field-group">
      <div class="field-group-title">Transform Pivot (World)</div>
      ${pivot ? `
        <div class="row"><label>X</label><span class="axis-x">${pivot.x.toFixed(3)}</span></div>
        <div class="row"><label>Y</label><span class="axis-y">${pivot.y.toFixed(3)}</span></div>
        <div class="row"><label>Z</label><span class="axis-z">${pivot.z.toFixed(3)}</span></div>
      ` : '<div class="empty-hint">頂点を選択するとギズモが表示されます</div>'}
    </div>
    <div class="field-group">
      <div class="field-group-title">Controls</div>
      <div class="edit-mode-help">
        Click: Select vertex<br>
        Shift + Click: Multi-select<br>
        A / Alt+A: Select all / Deselect<br>
        W / E / R: Move / Rotate / Scale<br>
        Tab: Return to Object Mode
      </div>
    </div>
  `;
  document.getElementById("vertex-select-all").addEventListener("click", selectAllVertices);
  document.getElementById("vertex-select-none").addEventListener("click", deselectAllVertices);
}

function deleteSelected() {
  if (editMode) {
    flashStatus("頂点削除は現在サポートされていません", true);
    return;
  }
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
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => {
        material.map?.dispose?.();
        material.dispose();
      });
    } else {
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
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
  if (editMode) {
    flashStatus("Edit Modeではオブジェクトを複製できません", true);
    return;
  }
  if (!selected) return;
  const o = selected;
  let clone;
  if (o.isMesh) {
    clone = new THREE.Mesh(o.geometry.clone(), o.material.clone());
    if (o.material.map) clone.material.map = o.material.map.clone();
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
  clone.userData = {
    ...o.userData,
    texture: o.userData.texture ? { ...o.userData.texture } : undefined,
  };
  userGroup.add(clone);
  markDirty();
  select(clone);
  commitHistory(`Duplicate ${o.name}`);
}

/* ---------- HUD ---------- */
function updateHud() {
  const transformLabel = transform.mode.charAt(0).toUpperCase() + transform.mode.slice(1);
  document.getElementById("hud-mode").textContent = editMode
    ? `Edit · Vertex · ${transformLabel}`
    : transformLabel;
  document.getElementById("hud-selection").textContent = editMode
    ? `${selectedVertexIndices.size} vertices`
    : selected?.name || "—";
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
      texture: obj.userData.texture ? { ...obj.userData.texture } : null,
    };
    if (obj.userData.geometryEdited) {
      data.geometry = {
        positions: Array.from(obj.geometry.getAttribute("position").array),
      };
    }
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
    if (data.material.texture) {
      applyTextureData(obj, data.material.texture, { showError: false });
    }
    const savedPositions = data.geometry?.positions;
    const positionAttribute = obj.geometry.getAttribute("position");
    if (
      Array.isArray(savedPositions) &&
      savedPositions.length === positionAttribute.array.length &&
      savedPositions.every(Number.isFinite)
    ) {
      positionAttribute.array.set(savedPositions);
      positionAttribute.needsUpdate = true;
      obj.geometry.computeVertexNormals();
      obj.geometry.computeBoundingBox();
      obj.geometry.computeBoundingSphere();
      obj.userData.geometryEdited = true;
    }
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
  const resumeEditMode = editMode;
  restoringHistory = true;
  loadingProject = true;
  try {
    clearUserObjects();
    const restored = state.scene.objects.map(restoreObject).filter(Boolean);
    if (Number.isInteger(state.scene.background)) scene.background.setHex(state.scene.background);
    rebuildCounters(state.counters);
    select(restored.find((obj) => obj.uuid === state.selectedObjectId) || null);
    if (resumeEditMode && selected?.isMesh) enterEditMode();
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
    else if (a === "export-fbx") exportFbx(false);
    else if (a === "export-fbx-selected") exportFbx(true);
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
function exportRoots(onlySelected) {
  if (onlySelected) return selected ? [selected] : [];
  return userGroup.children.filter((object) => !object.userData.helper);
}

async function exportFbx(onlySelected) {
  const roots = exportRoots(onlySelected);
  if (roots.length === 0) {
    flashStatus(onlySelected ? "オブジェクトを選択してください" : "オブジェクトがありません", true);
    return;
  }

  try {
    const hasIO = !!window.rentanaIO;
    const result = exportFBX(roots, {
      textureFolder: hasIO ? "textures" : "",
      embedTextures: true,
    });
    const defaultName = `${onlySelected && selected
      ? selected.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      : "scene"}-${Date.now()}.fbx`;

    if (!hasIO) {
      downloadBlob(new Blob([result.text], { type: "application/octet-stream" }), defaultName);
      result.textures.forEach((texture, index) => {
        setTimeout(() => {
          const filename = texture.relativePath.split("/").pop();
          downloadBlob(new Blob([texture.data], { type: texture.mimeType }), filename);
        }, (index + 1) * 100);
      });
      flashStatus(
        result.textures.length > 0
          ? `FBXとテクスチャ${result.textures.length}件をダウンロードしました`
          : "FBXをダウンロードしました"
      );
      return;
    }

    const picked = await window.rentanaIO.saveFile({
      title: "FBXエクスポート",
      defaultPath: defaultName,
      filters: [{ name: "Autodesk FBX", extensions: ["fbx"] }],
    });
    if (!picked.ok) {
      if (!picked.canceled) flashStatus(`エクスポート失敗: ${picked.error || "パスを選択できません"}`, true);
      return;
    }
    const filePath = picked.path.toLowerCase().endsWith(".fbx")
      ? picked.path
      : `${picked.path}.fbx`;
    const fbxWrite = await window.rentanaIO.writeText(filePath, result.text);
    if (!fbxWrite.ok) {
      flashStatus(`FBX保存失敗: ${fbxWrite.error}`, true);
      return;
    }
    if (result.textures.length > 0) {
      const textureWrite = await window.rentanaIO.writeExportFiles(
        filePath,
        result.textures.map((texture) => ({
          relativePath: texture.relativePath,
          data: texture.data.buffer.slice(
            texture.data.byteOffset,
            texture.data.byteOffset + texture.data.byteLength
          ),
        }))
      );
      if (!textureWrite.ok) {
        flashStatus(`FBXは保存しましたが、テクスチャ保存に失敗しました: ${textureWrite.error}`, true);
        return;
      }
    }
    flashStatus(
      result.textures.length > 0
        ? `保存しました: ${filePath}（テクスチャ${result.textures.length}件）`
        : `保存しました: ${filePath}`
    );
  } catch (error) {
    flashStatus(`FBXエクスポート失敗: ${error.message || error}`, true);
  }
}

async function exportScene(format, onlySelected) {
  const hasIO = !!window.rentanaIO;
  // ライトヘルパーや補助オブジェクトを除外したクローンを作る
  const exportGroup = new THREE.Group();
  const roots = exportRoots(onlySelected);
  roots.forEach((o) => {
    if (o.isLight && o.children.length) {
      // ライト本体（ヘルパーを除外してクローン）
      const lightClone = new o.constructor(o.color, o.intensity, o.distance, o.decay);
      lightClone.position.copy(o.position);
      lightClone.rotation.copy(o.rotation);
      lightClone.scale.copy(o.scale);
      lightClone.name = o.name;
      exportGroup.add(lightClone);
    } else if (o.isMesh) {
      // メッシュをクローン（共有ジオメトリOKだが安全にclone）
      const meshClone = new THREE.Mesh(o.geometry, o.material);
      meshClone.position.copy(o.position);
      meshClone.rotation.copy(o.rotation);
      meshClone.scale.copy(o.scale);
      meshClone.name = o.name;
      meshClone.userData = {
        ...o.userData,
        texture: o.userData.texture ? { ...o.userData.texture } : undefined,
      };
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
    const target = editMode ? editPivot : selected;
    dragStartPos.copy(target.position);
    dragStartRot.copy(target.rotation);
    dragStartScale.copy(target.scale);
  }
});
transform.addEventListener("objectChange", () => {
  showDragFeedback();
});

const feedbackEl = document.getElementById("drag-feedback");
function showDragFeedback() {
  if (!selected || !transform.dragging) { hideDragFeedback(); return; }
  const target = editMode ? editPivot : selected;
  let txt = "";
  if (transform.mode === "translate") {
    const dx = target.position.x - dragStartPos.x;
    const dy = target.position.y - dragStartPos.y;
    const dz = target.position.z - dragStartPos.z;
    txt = `${editMode ? "Vertices " : ""}Δpos (${dx.toFixed(2)}, ${dy.toFixed(2)}, ${dz.toFixed(2)})`;
  } else if (transform.mode === "rotate") {
    const dx = target.rotation.x - dragStartRot.x;
    const dy = target.rotation.y - dragStartRot.y;
    const dz = target.rotation.z - dragStartRot.z;
    txt = `${editMode ? "Vertices " : ""}Δrot (${THREE.MathUtils.radToDeg(dx).toFixed(0)}°, ${THREE.MathUtils.radToDeg(dy).toFixed(0)}°, ${THREE.MathUtils.radToDeg(dz).toFixed(0)}°)`;
  } else if (transform.mode === "scale") {
    const dx = target.scale.x / dragStartScale.x;
    const dy = target.scale.y / dragStartScale.y;
    const dz = target.scale.z / dragStartScale.z;
    txt = `${editMode ? "Vertices " : ""}×scale (${dx.toFixed(2)}, ${dy.toFixed(2)}, ${dz.toFixed(2)})`;
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
document.getElementById("editor-mode-toggle").addEventListener("click", toggleEditMode);
document.getElementById("vertex-select-mode").addEventListener("click", () => {
  if (editMode) flashStatus("Vertex Select Mode");
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

  if (key === "tab") {
    e.preventDefault();
    toggleEditMode();
    return;
  }
  if (editMode && key === "a") {
    e.preventDefault();
    if (e.altKey) deselectAllVertices();
    else selectAllVertices();
    return;
  }
  if (editMode && key === "1") {
    e.preventDefault();
    flashStatus("Vertex Select Mode");
    return;
  }

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
      if (editMode) deselectAllVertices();
      else if (axisState.axis) { setAxis(null); }
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
updateEditModeUI();
projectDirty = false;
updateProjectStatus();
resetHistory();
animate();
