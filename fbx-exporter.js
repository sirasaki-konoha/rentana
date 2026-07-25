import * as THREE from "three";

const FBX_VERSION = 7400;
const TEXTURE_DATA_URL = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i;
const SUPPORTED_TEXTURE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/bmp",
  "image/gif",
  "image/webp",
]);
const SUPPORTED_TEXTURE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "bmp",
  "gif",
  "webp",
]);
const ROTATION_ORDERS = {
  XYZ: 5,
  XZY: 2,
  YZX: 1,
  YXZ: 4,
  ZXY: 3,
  ZYX: 0,
};

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function fbxNumber(value) {
  const number = finiteNumber(value);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(9).replace(/\.?0+$/, "");
}

function fbxString(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"");
}

function fbxArray(values) {
  return Array.from(values, fbxNumber).join(",");
}

function dataBlock(name, values, indent = "\t\t") {
  return `${indent}${name}: *${values.length} {\n${indent}\ta: ${fbxArray(values)}\n${indent}}\n`;
}

function colorValues(color) {
  if (!color?.isColor) return [1, 1, 1];
  const srgb = new THREE.Color();
  color.getRGB(srgb, THREE.SRGBColorSpace);
  return [srgb.r, srgb.g, srgb.b];
}

function sanitizeFilename(name, fallback) {
  const clean = String(name || fallback)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return clean || fallback;
}

function extensionForMime(mimeType) {
  const extensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return extensions[mimeType.toLowerCase()] || "png";
}

function uniqueTexturePath(textureData, objectName, usedPaths, textureFolder) {
  const mimeExtension = extensionForMime(textureData.mimeType);
  const suppliedName = sanitizeFilename(
    textureData.name,
    `${sanitizeFilename(objectName, "texture")}.${mimeExtension}`
  );
  const suppliedExtension = suppliedName.includes(".")
    ? suppliedName.slice(suppliedName.lastIndexOf(".") + 1)
    : "";
  const filename = SUPPORTED_TEXTURE_EXTENSIONS.has(suppliedExtension.toLowerCase())
    ? suppliedName
    : `${suppliedExtension ? suppliedName.slice(0, suppliedName.lastIndexOf(".")) : suppliedName}.${mimeExtension}`;
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : `.${mimeExtension}`;
  const folder = String(textureFolder || "")
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");

  let suffix = 1;
  let candidate = filename;
  let relativePath = folder ? `${folder}/${candidate}` : candidate;
  while (usedPaths.has(relativePath.toLowerCase())) {
    candidate = `${stem}-${suffix}${extension}`;
    relativePath = folder ? `${folder}/${candidate}` : candidate;
    suffix += 1;
  }
  usedPaths.add(relativePath.toLowerCase());
  return relativePath;
}

export function decodeTextureDataUrl(dataUrl) {
  const match = typeof dataUrl === "string" ? dataUrl.match(TEXTURE_DATA_URL) : null;
  if (!match) throw new Error("テクスチャデータがBase64画像ではありません");
  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_TEXTURE_MIMES.has(mimeType)) {
    throw new Error(`未対応のテクスチャ形式です: ${mimeType}`);
  }

  const binary = globalThis.atob(match[2].replace(/\s/g, ""));
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
  return { mimeType, data };
}

function readTextureData(object) {
  const stored = object.userData?.texture;
  if (!stored?.dataUrl) return null;
  const decoded = decodeTextureDataUrl(stored.dataUrl);
  return {
    name: stored.name,
    mimeType: decoded.mimeType,
    dataUrl: stored.dataUrl,
    data: decoded.data,
  };
}

function geometryData(mesh) {
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute?.("position");
  if (!position || position.itemSize < 3) {
    throw new Error(`${mesh.name || "Mesh"} に頂点データがありません`);
  }

  const index = geometry.getIndex();
  const vertexIndices = index
    ? Array.from(index.array)
    : Array.from({ length: position.count }, (_value, i) => i);
  if (vertexIndices.some((value) => (
    !Number.isInteger(value) || value < 0 || value >= position.count
  ))) {
    throw new Error(`${mesh.name || "Mesh"} の頂点インデックスが不正です`);
  }
  const triangleIndexCount = vertexIndices.length - (vertexIndices.length % 3);
  const polygonVertexIndices = [];
  const normals = [];
  const uvs = [];
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  for (let i = 0; i < triangleIndexCount; i += 3) {
    const ia = vertexIndices[i];
    const ib = vertexIndices[i + 1];
    const ic = vertexIndices[i + 2];
    polygonVertexIndices.push(ia, ib, -(ic + 1));

    if (!normal) {
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      faceNormal.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    }

    [ia, ib, ic].forEach((vertexIndex) => {
      if (normal) {
        normals.push(
          finiteNumber(normal.getX(vertexIndex)),
          finiteNumber(normal.getY(vertexIndex)),
          finiteNumber(normal.getZ(vertexIndex))
        );
      } else {
        normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      }
      if (uv) {
        uvs.push(
          finiteNumber(uv.getX(vertexIndex)),
          finiteNumber(uv.getY(vertexIndex))
        );
      }
    });
  }

  const vertices = [];
  for (let i = 0; i < position.count; i += 1) {
    vertices.push(
      finiteNumber(position.getX(i)),
      finiteNumber(position.getY(i)),
      finiteNumber(position.getZ(i))
    );
  }

  return {
    vertices,
    polygonVertexIndices,
    normals,
    uvs: uv ? uvs : null,
  };
}

function geometryRecord(id, name, mesh) {
  const data = geometryData(mesh);
  let output = `\tGeometry: ${id}, "Geometry::${fbxString(name)}", "Mesh" {\n`;
  output += "\t\tGeometryVersion: 124\n";
  output += dataBlock("Vertices", data.vertices);
  output += dataBlock("PolygonVertexIndex", data.polygonVertexIndices);
  output += "\t\tLayerElementNormal: 0 {\n";
  output += "\t\t\tVersion: 101\n";
  output += "\t\t\tName: \"\"\n";
  output += "\t\t\tMappingInformationType: \"ByPolygonVertex\"\n";
  output += "\t\t\tReferenceInformationType: \"Direct\"\n";
  output += dataBlock("Normals", data.normals, "\t\t\t");
  output += "\t\t}\n";
  output += "\t\tLayerElementMaterial: 0 {\n";
  output += "\t\t\tVersion: 101\n";
  output += "\t\t\tName: \"\"\n";
  output += "\t\t\tMappingInformationType: \"AllSame\"\n";
  output += "\t\t\tReferenceInformationType: \"IndexToDirect\"\n";
  output += dataBlock("Materials", [0], "\t\t\t");
  output += "\t\t}\n";
  if (data.uvs) {
    output += "\t\tLayerElementUV: 0 {\n";
    output += "\t\t\tVersion: 101\n";
    output += "\t\t\tName: \"UVChannel_1\"\n";
    output += "\t\t\tMappingInformationType: \"ByPolygonVertex\"\n";
    output += "\t\t\tReferenceInformationType: \"Direct\"\n";
    output += dataBlock("UV", data.uvs, "\t\t\t");
    output += "\t\t}\n";
  }
  output += "\t\tLayer: 0 {\n";
  output += "\t\t\tVersion: 100\n";
  output += "\t\t\tLayerElement:  {\n";
  output += "\t\t\t\tType: \"LayerElementNormal\"\n";
  output += "\t\t\t\tTypedIndex: 0\n";
  output += "\t\t\t}\n";
  output += "\t\t\tLayerElement:  {\n";
  output += "\t\t\t\tType: \"LayerElementMaterial\"\n";
  output += "\t\t\t\tTypedIndex: 0\n";
  output += "\t\t\t}\n";
  if (data.uvs) {
    output += "\t\t\tLayerElement:  {\n";
    output += "\t\t\t\tType: \"LayerElementUV\"\n";
    output += "\t\t\t\tTypedIndex: 0\n";
    output += "\t\t\t}\n";
  }
  output += "\t\t}\n";
  output += "\t}\n";
  return output;
}

function transformProperties(object) {
  const position = object.position || { x: 0, y: 0, z: 0 };
  const rotation = object.rotation || { x: 0, y: 0, z: 0, order: "XYZ" };
  const scale = object.scale || { x: 1, y: 1, z: 1 };
  const degrees = [
    THREE.MathUtils.radToDeg(finiteNumber(rotation.x)),
    THREE.MathUtils.radToDeg(finiteNumber(rotation.y)),
    THREE.MathUtils.radToDeg(finiteNumber(rotation.z)),
  ];
  return [
    `\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${fbxNumber(position.x)},${fbxNumber(position.y)},${fbxNumber(position.z)}`,
    `\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",${fbxArray(degrees)}`,
    `\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",${fbxNumber(scale.x)},${fbxNumber(scale.y)},${fbxNumber(scale.z)}`,
    `\t\t\tP: "RotationOrder", "enum", "", "",${ROTATION_ORDERS[rotation.order] ?? 0}`,
    `\t\t\tP: "Visibility", "Visibility", "", "A",${object.visible === false ? 0 : 1}`,
  ].join("\n");
}

function modelRecord(id, name, objectType, object) {
  return (
    `\tModel: ${id}, "Model::${fbxString(name)}", "${objectType}" {\n` +
    "\t\tVersion: 232\n" +
    "\t\tProperties70:  {\n" +
    `${transformProperties(object)}\n` +
    "\t\t}\n" +
    "\t\tShading: T\n" +
    "\t\tCulling: \"CullingOff\"\n" +
    "\t}\n"
  );
}

function materialRecord(id, name, material) {
  const color = colorValues(material?.color);
  const opacity = THREE.MathUtils.clamp(finiteNumber(material?.opacity, 1), 0, 1);
  const roughness = THREE.MathUtils.clamp(finiteNumber(material?.roughness, 0.5), 0, 1);
  const shininess = (1 - roughness) * 100;
  return (
    `\tMaterial: ${id}, "Material::${fbxString(name)}", "" {\n` +
    "\t\tVersion: 102\n" +
    "\t\tShadingModel: \"phong\"\n" +
    "\t\tMultiLayer: 0\n" +
    "\t\tProperties70:  {\n" +
    `\t\t\tP: "DiffuseColor", "Color", "", "A",${fbxArray(color)}\n` +
    `\t\t\tP: "DiffuseFactor", "Number", "", "A",1\n` +
    `\t\t\tP: "Shininess", "double", "Number", "A",${fbxNumber(shininess)}\n` +
    `\t\t\tP: "Opacity", "double", "Number", "A",${fbxNumber(opacity)}\n` +
    `\t\t\tP: "TransparencyFactor", "Number", "", "A",${fbxNumber(1 - opacity)}\n` +
    "\t\t}\n" +
    "\t}\n"
  );
}

function textureRecords(textureId, videoId, name, relativePath, textureData, embedTextures) {
  const path = fbxString(relativePath);
  const textureName = fbxString(name);
  let output =
    `\tTexture: ${textureId}, "Texture::${textureName}", "" {\n` +
    "\t\tType: \"TextureVideoClip\"\n" +
    "\t\tVersion: 202\n" +
    `\t\tTextureName: "Texture::${textureName}"\n` +
    `\t\tMedia: "Video::${textureName}"\n` +
    `\t\tFileName: "${path}"\n` +
    `\t\tRelativeFilename: "${path}"\n` +
    "\t\tModelUVTranslation: 0,0\n" +
    "\t\tModelUVScaling: 1,1\n" +
    "\t\tTexture_Alpha_Source: \"None\"\n" +
    "\t\tCropping: 0,0,0,0\n" +
    "\t}\n" +
    `\tVideo: ${videoId}, "Video::${textureName}", "Clip" {\n` +
    "\t\tType: \"Clip\"\n" +
    "\t\tProperties70:  {\n" +
    "\t\t\tP: \"Path\", \"KString\", \"XRefUrl\", \"\", \"\"\n" +
    "\t\t}\n" +
    `\t\tFileName: "${path}"\n` +
    `\t\tRelativeFilename: "${path}"\n`;
  if (embedTextures) {
    const base64 = textureData.dataUrl.slice(textureData.dataUrl.indexOf(",") + 1);
    output += `\t\tContent: "${base64}"\n`;
  }
  output += "\t}\n";
  return output;
}

function lightAttributeRecord(id, name, light) {
  const color = colorValues(light.color);
  const intensity = Math.max(0, finiteNumber(light.intensity, 1)) * 100;
  const distance = Math.max(0, finiteNumber(light.distance));
  return (
    `\tNodeAttribute: ${id}, "NodeAttribute::${fbxString(name)}", "Light" {\n` +
    "\t\tTypeFlags: \"Light\"\n" +
    "\t\tGeometryVersion: 124\n" +
    "\t\tProperties70:  {\n" +
    "\t\t\tP: \"LightType\", \"enum\", \"\", \"\",0\n" +
    `\t\t\tP: "Color", "Color", "", "A",${fbxArray(color)}\n` +
    `\t\t\tP: "Intensity", "double", "Number", "A",${fbxNumber(intensity)}\n` +
    `\t\t\tP: "EnableFarAttenuation", "bool", "", "",${distance > 0 ? 1 : 0}\n` +
    `\t\t\tP: "FarAttenuationEnd", "double", "Number", "A",${fbxNumber(distance)}\n` +
    "\t\t}\n" +
    "\t}\n"
  );
}

function definitions(records) {
  const counts = {
    Model: records.length,
    Geometry: records.filter((record) => record.kind === "mesh").length,
    Material: records.filter((record) => record.kind === "mesh").length,
    Texture: records.filter((record) => record.texture).length,
    Video: records.filter((record) => record.texture).length,
    NodeAttribute: records.filter((record) => record.kind === "light").length,
  };
  const types = Object.entries(counts).filter(([, count]) => count > 0);
  const total = types.reduce((sum, [, count]) => sum + count, 0);
  let output = `Definitions:  {\n\tVersion: 100\n\tCount: ${total}\n`;
  types.forEach(([type, count]) => {
    output += `\tObjectType: "${type}" {\n\t\tCount: ${count}\n\t}\n`;
  });
  output += "}\n";
  return output;
}

/**
 * Exports Rentana mesh and point-light objects as an ASCII FBX 7.4 document.
 * Image bytes are returned separately so the caller can write them next to the FBX.
 */
export function exportFBX(objects, options = {}) {
  const roots = Array.from(objects || []).filter((object) => (
    object && !object.userData?.helper && (object.isMesh || object.isPointLight)
  ));
  if (roots.length === 0) throw new Error("エクスポートできるオブジェクトがありません");

  const textureFolder = options.textureFolder ?? "textures";
  const embedTextures = options.embedTextures !== false;
  const usedPaths = new Set();
  const textures = [];
  let nextId = 100000;
  const records = roots.map((object, index) => {
    const name = object.name || `${object.isMesh ? "Mesh" : "Light"}.${index}`;
    if (object.isMesh) {
      const record = {
        kind: "mesh",
        object,
        name,
        geometryId: nextId++,
        modelId: nextId++,
        materialId: nextId++,
        texture: null,
      };
      const textureData = readTextureData(object);
      if (textureData) {
        const relativePath = uniqueTexturePath(
          textureData,
          name,
          usedPaths,
          textureFolder
        );
        record.texture = {
          id: nextId++,
          videoId: nextId++,
          relativePath,
          ...textureData,
        };
        textures.push({
          relativePath,
          mimeType: textureData.mimeType,
          data: textureData.data,
        });
      }
      return record;
    }
    return {
      kind: "light",
      object,
      name,
      attributeId: nextId++,
      modelId: nextId++,
    };
  });

  let output =
    "; FBX 7.4.0 project file\n" +
    "; Created by Rentana\n\n" +
    "FBXHeaderExtension:  {\n" +
    "\tFBXHeaderVersion: 1003\n" +
    `\tFBXVersion: ${FBX_VERSION}\n` +
    "\tEncryptionType: 0\n" +
    "\tCreator: \"Rentana\"\n" +
    "}\n" +
    "GlobalSettings:  {\n" +
    "\tVersion: 1000\n" +
    "\tProperties70:  {\n" +
    "\t\tP: \"UpAxis\", \"int\", \"Integer\", \"\",1\n" +
    "\t\tP: \"UpAxisSign\", \"int\", \"Integer\", \"\",1\n" +
    "\t\tP: \"FrontAxis\", \"int\", \"Integer\", \"\",2\n" +
    "\t\tP: \"FrontAxisSign\", \"int\", \"Integer\", \"\",-1\n" +
    "\t\tP: \"CoordAxis\", \"int\", \"Integer\", \"\",0\n" +
    "\t\tP: \"CoordAxisSign\", \"int\", \"Integer\", \"\",1\n" +
    "\t\tP: \"UnitScaleFactor\", \"double\", \"Number\", \"\",100\n" +
    "\t\tP: \"OriginalUnitScaleFactor\", \"double\", \"Number\", \"\",100\n" +
    "\t}\n" +
    "}\n";
  output += definitions(records);
  output += "Objects:  {\n";
  records.forEach((record) => {
    if (record.kind === "mesh") {
      output += geometryRecord(record.geometryId, record.name, record.object);
      output += modelRecord(record.modelId, record.name, "Mesh", record.object);
      output += materialRecord(
        record.materialId,
        `${record.name} Material`,
        record.object.material
      );
      if (record.texture) {
        output += textureRecords(
          record.texture.id,
          record.texture.videoId,
          `${record.name} Texture`,
          record.texture.relativePath,
          record.texture,
          embedTextures
        );
      }
    } else {
      output += lightAttributeRecord(
        record.attributeId,
        record.name,
        record.object
      );
      output += modelRecord(record.modelId, record.name, "Light", record.object);
    }
  });
  output += "}\n";

  output += "Connections:  {\n";
  records.forEach((record) => {
    if (record.kind === "mesh") {
      output += `\tC: "OO",${record.geometryId},${record.modelId}\n`;
      output += `\tC: "OO",${record.materialId},${record.modelId}\n`;
      if (record.texture) {
        output += `\tC: "OP",${record.texture.id},${record.materialId},"DiffuseColor"\n`;
        output += `\tC: "OO",${record.texture.videoId},${record.texture.id}\n`;
      }
    } else {
      output += `\tC: "OO",${record.attributeId},${record.modelId}\n`;
    }
    output += `\tC: "OO",${record.modelId},0\n`;
  });
  output += "}\n";

  return { text: output, textures };
}
