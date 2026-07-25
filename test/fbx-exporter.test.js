import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { exportFBX } from "../fbx-exporter.js";

function parseFbx(text) {
  return new FBXLoader().parse(new TextEncoder().encode(text).buffer, "");
}

test("mesh geometry, transform, UVs, normals and material round-trip through FBXLoader", () => {
  const material = new THREE.MeshStandardMaterial({
    color: 0x336699,
    opacity: 0.7,
    transparent: true,
    roughness: 0.25,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), material);
  mesh.name = "Export Cube";
  mesh.position.set(1, 2, 3);
  mesh.rotation.set(0.1, 0.2, 0.3);
  mesh.scale.set(1.5, 2, 0.5);

  const { text, textures } = exportFBX([mesh]);
  const imported = parseFbx(text).children[0];

  assert.equal(textures.length, 0);
  assert.equal(imported.userData.originalName, "Export Cube");
  assert.deepEqual(imported.position.toArray(), [1, 2, 3]);
  assert.ok(Math.abs(imported.rotation.x - mesh.rotation.x) < 1e-6);
  assert.ok(Math.abs(imported.rotation.y - mesh.rotation.y) < 1e-6);
  assert.ok(Math.abs(imported.rotation.z - mesh.rotation.z) < 1e-6);
  assert.ok(imported.scale.distanceTo(new THREE.Vector3(1.5, 2, 0.5)) < 1e-6);
  assert.equal(imported.material.color.getHex(), 0x336699);
  assert.equal(imported.material.opacity, 0.7);
  assert.equal(imported.material.transparent, true);
  assert.ok(imported.geometry.getAttribute("position").count > 0);
  assert.equal(
    imported.geometry.getAttribute("uv").count,
    imported.geometry.getAttribute("position").count
  );
  assert.equal(
    imported.geometry.getAttribute("normal").count,
    imported.geometry.getAttribute("position").count
  );
});

test("point lights retain their basic FBX properties", () => {
  const light = new THREE.PointLight(0xff8844, 5, 12, 2);
  light.name = "Lamp";
  light.position.set(2, 3, 4);

  const imported = parseFbx(exportFBX([light]).text).children[0];

  assert.equal(imported.type, "PointLight");
  assert.equal(imported.name, "Lamp");
  assert.equal(imported.color.getHex(), 0xff8844);
  assert.equal(imported.intensity, 5);
  assert.equal(imported.distance, 12);
  assert.deepEqual(imported.position.toArray(), [2, 3, 4]);
});

test("texture data is embedded and returned for external file writing", () => {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XG8N3wAAAABJRU5ErkJggg==";
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.name = "Textured Plane";
  mesh.userData.texture = {
    name: "albedo.png",
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${pngBase64}`,
  };

  const { text, textures } = exportFBX([mesh], {
    textureFolder: "textures",
    embedTextures: true,
  });

  assert.equal(textures.length, 1);
  assert.equal(textures[0].relativePath, "textures/albedo.png");
  assert.equal(textures[0].mimeType, "image/png");
  assert.deepEqual(Array.from(textures[0].data.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(text, /RelativeFilename: "textures\/albedo\.png"/);
  assert.ok(text.includes(`Content: "${pngBase64}"`));
  assert.match(text, /C: "OP",\d+,\d+,"DiffuseColor"/);

  const originalDocument = globalThis.document;
  globalThis.document = {
    createElementNS: () => ({
      addEventListener() {},
      removeEventListener() {},
      set src(value) {
        this.currentSrc = value;
      },
    }),
  };
  try {
    const imported = parseFbx(text).children[0];
    assert.equal(imported.material.map?.isTexture, true);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("export rejects a scene without supported objects", () => {
  assert.throws(() => exportFBX([]), /オブジェクト/);
});
