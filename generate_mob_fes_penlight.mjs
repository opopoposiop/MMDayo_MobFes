/**
 * MobFesPenlight.pmx を標準Node.jsだけで生成する。
 *
 * HOW:
 *   `node generate_mob_fes_penlight.mjs` を実行すると、同じフォルダへPMX 2.0
 *   バイナリを書き出す。外部パッケージは不要。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


// =============================================================================
// ユーザーが変更してよい箇所
// =============================================================================
// HOW: 本数を軽くして試す場合はINSTANCE_COUNTを小さくする。
// fxdayo側のMOB_INSTANCE_COUNTと総頂点数も必ず同時に変更する。
const INSTANCE_COUNT = 4000;
const SEGMENTS = 6;
// HOW: 引数で通常版、演算共有版、ビルボード版の出力先を切り替える。
const OPTIMIZED_VARIANT = process.argv.includes("--optimized");
const BILLBOARD_VARIANT = process.argv.includes("--billboard");
if (OPTIMIZED_VARIANT && BILLBOARD_VARIANT) {
  throw new Error("--optimized と --billboard は同時に指定できません");
}
const OUTPUT_NAME = BILLBOARD_VARIANT
  ? "MobFesPenlight_3.pmx"
  : OPTIMIZED_VARIANT
    ? "MobFesPenlight_2.pmx"
    : "MobFesPenlight.pmx";


// =============================================================================
// ユーザー変更不可の箇所
// =============================================================================
// Why not: PMXの件数・索引サイズは全セクションで連動するため、ここから下を
// 部分的に変えるとPMXEditorやMikuMikuDayoが読めないファイルになる。
// Codex用覚書: PMX 2.0、UTF-16LE、頂点索引4 byte、その他索引1 byteで固定。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(HERE, OUTPUT_NAME);
// HOW: ボーン追加時の番号ずれを、頂点ウェイト・モーフ・表示枠へ一括反映する。
const BONE_INDEX = Object.freeze({
  ROOT: 0,
  CENTER: 1,
  CONTROL: 2,
  PENLIGHT_A: 3,
  PENLIGHT_B: 4,
});
// HOW: 4系統を初期状態から別色にし、モーフ0でも4色同時表示にする。
const GLOW_GROUPS = [
  { jp: "色1", en: "Color1", baseRgb: [0.05, 1.0, 0.12] },
  { jp: "色2", en: "Color2", baseRgb: [1.0, 0.08, 0.55] },
  { jp: "色3", en: "Color3", baseRgb: [0.04, 0.30, 1.0] },
  { jp: "色4", en: "Color4", baseRgb: [1.0, 0.32, 0.03] },
];
const AL_BASE_SHININESS = 110.0;
const AL_MAX_MORPH_SHININESS = 180.0;


class BinaryWriter {
  constructor(initialSize = 16 * 1024 * 1024) {
    this.buffer = Buffer.allocUnsafe(initialSize);
    this.offset = 0;
  }

  // HOW: 書き込み前に領域を倍増し、大きなPMXでも途中で切れないようにする。
  ensure(byteCount) {
    if (this.offset + byteCount <= this.buffer.length) return;
    let nextSize = this.buffer.length;
    while (this.offset + byteCount > nextSize) nextSize *= 2;
    const next = Buffer.allocUnsafe(nextSize);
    this.buffer.copy(next, 0, 0, this.offset);
    this.buffer = next;
  }

  bytes(value) {
    this.ensure(value.length);
    value.copy(this.buffer, this.offset);
    this.offset += value.length;
  }

  u8(value) {
    this.ensure(1);
    this.buffer.writeUInt8(value, this.offset);
    this.offset += 1;
  }

  i8(value) {
    this.ensure(1);
    this.buffer.writeInt8(value, this.offset);
    this.offset += 1;
  }

  u16(value) {
    this.ensure(2);
    this.buffer.writeUInt16LE(value, this.offset);
    this.offset += 2;
  }

  i32(value) {
    this.ensure(4);
    this.buffer.writeInt32LE(value, this.offset);
    this.offset += 4;
  }

  u32(value) {
    this.ensure(4);
    this.buffer.writeUInt32LE(value, this.offset);
    this.offset += 4;
  }

  f32(value) {
    this.ensure(4);
    this.buffer.writeFloatLE(value, this.offset);
    this.offset += 4;
  }

  f32Array(values) {
    for (const value of values) this.f32(value);
  }

  // HOW: PMX 2.0の可変長UTF-16LE文字列として書き出す。
  text(value) {
    const raw = Buffer.from(value, "utf16le");
    this.i32(raw.length);
    this.bytes(raw);
  }

  save(filename) {
    fs.writeFileSync(filename, this.buffer.subarray(0, this.offset));
  }
}


// HOW: 6角柱の側面と片側キャップを作り、軽量なペン部品にする。
function cylinderMesh({
  radiusBottom,
  radiusTop,
  yBottom,
  yTop,
  capAtTop,
  bone,
}) {
  const vertices = [];
  const triangles = [];
  const rings = [[radiusBottom, yBottom], [radiusTop, yTop]];

  for (let ring = 0; ring < rings.length; ring += 1) {
    const [radius, y] = rings[ring];
    for (let i = 0; i < SEGMENTS; i += 1) {
      const angle = (2 * Math.PI * i) / SEGMENTS;
      vertices.push({
        position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
        normal: [Math.cos(angle), 0, Math.sin(angle)],
        uv: [i / SEGMENTS, ring],
        bone,
      });
    }
  }

  for (let i = 0; i < SEGMENTS; i += 1) {
    const j = (i + 1) % SEGMENTS;
    triangles.push([i, j, SEGMENTS + i], [j, SEGMENTS + j, SEGMENTS + i]);
  }

  const capY = capAtTop ? yTop : yBottom;
  const capNormal = capAtTop ? [0, 1, 0] : [0, -1, 0];
  const center = vertices.length;
  vertices.push({ position: [0, capY, 0], normal: capNormal, uv: [0.5, 0.5], bone });
  const ringStart = capAtTop ? SEGMENTS : 0;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const j = (i + 1) % SEGMENTS;
    triangles.push(
      capAtTop
        ? [center, ringStart + i, ringStart + j]
        : [center, ringStart + j, ringStart + i],
    );
  }
  return { vertices, triangles };
}


// HOW: 遠景用に、持ち手または発光部を4頂点・2三角形の板として作る。
function billboardQuadMesh({
  halfWidth,
  yBottom,
  yTop,
  depthOffset,
  bone,
}) {
  return {
    vertices: [
      { position: [-halfWidth, yBottom, depthOffset], normal: [0, 0, 1], uv: [0, 1], bone },
      { position: [halfWidth, yBottom, depthOffset], normal: [0, 0, 1], uv: [1, 1], bone },
      { position: [-halfWidth, yTop, depthOffset], normal: [0, 0, 1], uv: [0, 0], bone },
      { position: [halfWidth, yTop, depthOffset], normal: [0, 0, 1], uv: [1, 0], bone },
    ],
    triangles: [[0, 1, 2], [1, 3, 2]],
  };
}


// HOW: 1本8頂点・4三角形に抑え、4000本でもBLAS更新量を小さくする。
function buildBillboardGeometry() {
  const vertices = [];
  const handleIndices = [];
  const glowIndicesByGroup = GLOW_GROUPS.map(() => []);
  let verticesPerInstance = 0;
  const variants = [
    {
      handleHalfWidth: 0.16, handleBottom: -0.38, handleTop: 0.34,
      glowHalfWidth: 0.115, glowBottom: 0.28, glowTop: 2.72,
    },
    {
      handleHalfWidth: 0.18, handleBottom: -0.42, handleTop: 0.32,
      glowHalfWidth: 0.105, glowBottom: 0.26, glowTop: 3.02,
    },
  ];

  for (let instance = 0; instance < INSTANCE_COUNT; instance += 1) {
    const variantIndex = instance & 1;
    const p = variants[variantIndex];
    const bone = BONE_INDEX.PENLIGHT_A + variantIndex;
    const instanceStart = vertices.length;
    const handle = billboardQuadMesh({
      halfWidth: p.handleHalfWidth,
      yBottom: p.handleBottom,
      yTop: p.handleTop,
      depthOffset: -0.003,
      bone,
    });
    vertices.push(...handle.vertices);
    for (const face of handle.triangles) {
      for (const index of face) handleIndices.push(instanceStart + index);
    }

    const glowStart = vertices.length;
    const glow = billboardQuadMesh({
      halfWidth: p.glowHalfWidth,
      yBottom: p.glowBottom,
      yTop: p.glowTop,
      depthOffset: 0.003,
      bone,
    });
    vertices.push(...glow.vertices);
    const glowIndices = glowIndicesByGroup[instance % GLOW_GROUPS.length];
    for (const face of glow.triangles) {
      for (const index of face) glowIndices.push(glowStart + index);
    }

    const count = vertices.length - instanceStart;
    if (instance === 0) verticesPerInstance = count;
    if (count !== verticesPerInstance) throw new Error("2種類のビルボード頂点数が一致していません");
  }
  return { vertices, handleIndices, glowIndicesByGroup, verticesPerInstance };
}


// HOW: 2種類を交互に割り当て、4000本分の描画スロットを構築する。
function buildGeometry() {
  if (BILLBOARD_VARIANT) return buildBillboardGeometry();
  const vertices = [];
  const handleIndices = [];
  const glowIndicesByGroup = GLOW_GROUPS.map(() => []);
  let verticesPerInstance = 0;
  const variants = [
    {
      handleR: 0.16, handleBottom: -0.38, handleTop: 0.34,
      glowR0: 0.115, glowR1: 0.105, glowBottom: 0.28, glowTop: 2.72,
    },
    {
      handleR: 0.18, handleBottom: -0.42, handleTop: 0.32,
      glowR0: 0.105, glowR1: 0.085, glowBottom: 0.26, glowTop: 3.02,
    },
  ];

  for (let instance = 0; instance < INSTANCE_COUNT; instance += 1) {
    const variantIndex = instance & 1;
    const p = variants[variantIndex];
    const bone = BONE_INDEX.PENLIGHT_A + variantIndex;
    const instanceStart = vertices.length;
    const handle = cylinderMesh({
      radiusBottom: p.handleR,
      radiusTop: p.handleR * 0.92,
      yBottom: p.handleBottom,
      yTop: p.handleTop,
      capAtTop: false,
      bone,
    });
    vertices.push(...handle.vertices);
    for (const face of handle.triangles) {
      for (const index of face) handleIndices.push(instanceStart + index);
    }

    const glowStart = vertices.length;
    const glow = cylinderMesh({
      radiusBottom: p.glowR0,
      radiusTop: p.glowR1,
      yBottom: p.glowBottom,
      yTop: p.glowTop,
      capAtTop: true,
      bone,
    });
    vertices.push(...glow.vertices);
    const glowIndices = glowIndicesByGroup[instance % GLOW_GROUPS.length];
    for (const face of glow.triangles) {
      for (const index of face) glowIndices.push(glowStart + index);
    }

    const count = vertices.length - instanceStart;
    if (instance === 0) verticesPerInstance = count;
    if (count !== verticesPerInstance) throw new Error("2種類の頂点数が一致していません");
  }
  return { vertices, handleIndices, glowIndicesByGroup, verticesPerInstance };
}


// HOW: 基準値から目標値へのマテリアル加算量を作る。
function difference(base, target) {
  return base.map((value, index) => target[index] - value);
}


// HOW: 指定した色グループだけを目的色へ変えるPMXマテリアルモーフを作る。
function materialMorph(groupIndex, suffixJp, suffixEn, targetRgb) {
  const group = GLOW_GROUPS[groupIndex];
  const baseDiffuse = [...group.baseRgb, 1.0];
  const targetDiffuse = [...targetRgb, 1.0];
  const baseAmbient = group.baseRgb.map((value) => value * 0.75);
  const targetAmbient = targetRgb.map((value) => value * 0.75);
  return {
    nameJp: `${group.jp}_${suffixJp}`,
    nameEn: `${group.en}_${suffixEn}`,
    // HOW: PMXのモーフ分類「目」(2)へ色相・彩度・明度をまとめる。
    panel: 2,
    type: 8,
    items: [{
      material: groupIndex + 1,
      operation: 1,
      diffuse: difference(baseDiffuse, targetDiffuse),
      specular: [0, 0, 0],
      specularity: 0,
      ambient: difference(baseAmbient, targetAmbient),
      edgeColor: [0, 0, 0, 0],
      edgeSize: 0,
      texture: [0, 0, 0, 0],
      sphere: [0, 0, 0, 0],
      toon: [0, 0, 0, 0],
    }],
  };
}


// HOW: MMDayo_AL方式AのShininessを110から180へ上げ、1倍から8倍へ増幅する。
function alIntensityMorph(groupIndex) {
  const group = GLOW_GROUPS[groupIndex];
  return {
    nameJp: `${group.jp}_AL強度`,
    nameEn: `${group.en}_ALIntensity`,
    // HOW: 発光関係はPMXのモーフ分類「リップ」(3)へまとめる。
    panel: 3,
    type: 8,
    items: [{
      material: groupIndex + 1,
      operation: 1,
      diffuse: [0, 0, 0, 0],
      specular: [0, 0, 0],
      specularity: AL_MAX_MORPH_SHININESS - AL_BASE_SHININESS,
      ambient: [0, 0, 0],
      edgeColor: [0, 0, 0, 0],
      edgeSize: 0,
      texture: [0, 0, 0, 0],
      sphere: [0, 0, 0, 0],
      toon: [0, 0, 0, 0],
    }],
  };
}


// HOW: 4色を同時に消し、PPALのShininess閾値100未満へ下げる。
function globalLightOffMorph() {
  return {
    nameJp: "AL消灯_全体",
    nameEn: "AL_Off_All",
    panel: 3,
    type: 8,
    items: GLOW_GROUPS.map((group, groupIndex) => ({
      material: groupIndex + 1,
      operation: 1,
      diffuse: difference([...group.baseRgb, 1.0], [0.015, 0.015, 0.015, 1.0]),
      specular: [0, 0, 0],
      specularity: -AL_BASE_SHININESS,
      ambient: difference(group.baseRgb.map((value) => value * 0.75), [0, 0, 0]),
      edgeColor: [0, 0, 0, 0],
      edgeSize: 0,
      texture: [0, 0, 0, 0],
      sphere: [0, 0, 0, 0],
      toon: [0, 0, 0, 0],
    })),
  };
}


// HOW: fxdayoが0～1のスライダー値を受け取るための制御モーフを作る。
function controlMorph(nameJp, nameEn) {
  return {
    nameJp,
    nameEn,
    panel: 4,
    type: 2,
    items: [{
      bone: BONE_INDEX.CONTROL,
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    }],
  };
}


// HOW: 各色グループへ独立したHSV系プリセットとAL強度を割り当てる。
function buildMorphs() {
  const morphs = [];
  const hueTargets = [
    ["H赤", "HueRed", [1.0, 0.04, 0.03]],
    ["H橙", "HueOrange", [1.0, 0.32, 0.03]],
    ["H黄", "HueYellow", [1.0, 0.92, 0.04]],
    ["H緑", "HueGreen", [0.05, 1.0, 0.12]],
    ["Hシアン", "HueCyan", [0.02, 0.95, 1.0]],
    ["H青", "HueBlue", [0.04, 0.18, 1.0]],
    ["H紫", "HuePurple", [0.62, 0.08, 1.0]],
    ["H桃", "HuePink", [1.0, 0.08, 0.55]],
  ];

  for (let groupIndex = 0; groupIndex < GLOW_GROUPS.length; groupIndex += 1) {
    const group = GLOW_GROUPS[groupIndex];
    for (const [suffixJp, suffixEn, targetRgb] of hueTargets) {
      morphs.push(materialMorph(groupIndex, suffixJp, suffixEn, targetRgb));
    }
    morphs.push(materialMorph(groupIndex, "S0", "Saturation0", [1.0, 1.0, 1.0]));
    morphs.push(materialMorph(
      groupIndex,
      "V50",
      "Value50",
      group.baseRgb.map((value) => value * 0.5),
    ));
    morphs.push(alIntensityMorph(groupIndex));
  }

  morphs.push(globalLightOffMorph());
  morphs.push(
    controlMorph("テンポ", "Tempo"),
    controlMorph("振幅", "Swing"),
    controlMorph("X振幅", "XSwingAmplitude"),
    controlMorph("Y振幅", "YSwingAmplitude"),
    controlMorph("Z振幅", "ZSwingAmplitude"),
    controlMorph("Yゆらぎ", "YBob"),
    controlMorph("ゆらぎ停止", "StopMotion"),
    controlMorph("同調", "Synchronization"),
    controlMorph("ばらつき", "Randomness"),
    controlMorph("配置幅", "AreaWidth"),
    controlMorph("配置奥行", "AreaDepth"),
  );
  return morphs;
}


// HOW: テクスチャを使わないPMXマテリアルを1件書く。
function writeMaterial(writer, material) {
  writer.text(material.nameJp);
  writer.text(material.nameEn);
  writer.f32Array(material.diffuse);
  writer.f32Array(material.specular);
  writer.f32(material.specularity);
  writer.f32Array(material.ambient);
  writer.u8(material.flags);
  writer.f32Array(material.edgeColor);
  writer.f32(material.edgeSize);
  writer.i8(-1);
  writer.i8(-1);
  writer.u8(0);
  writer.u8(1);
  writer.u8(0);
  writer.text(material.memo);
  writer.i32(material.indexCount);
}


// HOW: 末端を座標オフセットで指定する単純ボーンを1件書く。
function writeBone(writer, bone) {
  writer.text(bone.nameJp);
  writer.text(bone.nameEn);
  writer.f32Array(bone.position);
  writer.i8(bone.parent);
  writer.i32(0);
  writer.u16(bone.flags);
  writer.f32Array(bone.tailOffset);
}


// HOW: 骨制御またはマテリアル加算モーフをPMX形式で書く。
function writeMorph(writer, morph) {
  writer.text(morph.nameJp);
  writer.text(morph.nameEn);
  writer.u8(morph.panel);
  writer.u8(morph.type);
  writer.i32(morph.items.length);
  for (const item of morph.items) {
    if (morph.type === 2) {
      writer.i8(item.bone);
      writer.f32Array(item.translation);
      writer.f32Array(item.rotation);
    } else if (morph.type === 8) {
      writer.i8(item.material);
      writer.u8(item.operation);
      writer.f32Array(item.diffuse);
      writer.f32Array(item.specular);
      writer.f32(item.specularity);
      writer.f32Array(item.ambient);
      writer.f32Array(item.edgeColor);
      writer.f32(item.edgeSize);
      writer.f32Array(item.texture);
      writer.f32Array(item.sphere);
      writer.f32Array(item.toon);
    } else {
      throw new Error(`未対応のモーフ種別: ${morph.type}`);
    }
  }
}


// HOW: PMX操作画面にボーン・モーフを表示する枠を書き込む。
function writeDisplayFrame(writer, nameJp, nameEn, special, elements) {
  writer.text(nameJp);
  writer.text(nameEn);
  writer.u8(special);
  writer.i32(elements.length);
  for (const [elementType, index] of elements) {
    writer.u8(elementType);
    writer.i8(index);
  }
}


// HOW: PMX全セクションを仕様順に構築し、完成ファイルを書き出す。
function generate() {
  const geometry = buildGeometry();
  const allIndices = [
    ...geometry.handleIndices,
    ...geometry.glowIndicesByGroup.flat(),
  ];
  const morphs = buildMorphs();
  const materials = [
    {
      nameJp: "グリップ",
      nameEn: "Grip",
      diffuse: [0.055, 0.065, 0.075, 1.0],
      specular: [0.18, 0.18, 0.18],
      specularity: 18.0,
      ambient: [0.018, 0.021, 0.024],
      flags: 0x01,
      edgeColor: [0, 0, 0, 1],
      edgeSize: 0,
      memo: "ペンライトの持ち手",
      indexCount: geometry.handleIndices.length,
    },
    ...GLOW_GROUPS.map((group, groupIndex) => ({
      nameJp: `発光部_${group.jp}`,
      nameEn: `Glow_${group.en}`,
      diffuse: [...group.baseRgb, 1.0],
      // Why not: MMDayo_AL方式Aはスペキュラ色が黒でない材質を発光対象にしない。
      specular: [0, 0, 0],
      // HOW: 110は公式式 (Shininess-100)/10 で標準1倍になる。
      specularity: AL_BASE_SHININESS,
      ambient: group.baseRgb.map((value) => value * 0.75),
      flags: 0x01,
      edgeColor: [0, 0, 0, 1],
      edgeSize: 0,
      memo: `MMDayo_AL対応・${group.jp}独立HSV/強度モーフ`,
      indexCount: geometry.glowIndicesByGroup[groupIndex].length,
    })),
  ];
  const bones = [
    // HOW: 全ての親とセンターは、回転・移動・表示・操作を許可する。
    { nameJp: "全ての親", nameEn: "Root", position: [0, 0, 0], parent: -1, flags: 0x001e, tailOffset: [0, 1, 0] },
    { nameJp: "センター", nameEn: "Center", position: [0, 0, 0], parent: BONE_INDEX.ROOT, flags: 0x001e, tailOffset: [0, 1, 0] },
    // Why not: 制御ボーンはfxdayoへモーフ値を渡すだけなので、手動移動は許可しない。
    { nameJp: "制御", nameEn: "Control", position: [0, 0, 0], parent: BONE_INDEX.CENTER, flags: 0x0018, tailOffset: [0, 1, 0] },
    { nameJp: "ペンライトA", nameEn: "PenlightA", position: [0, 0, 0], parent: BONE_INDEX.CENTER, flags: 0x001a, tailOffset: [0, 1, 0] },
    { nameJp: "ペンライトB", nameEn: "PenlightB", position: [0, 0, 0], parent: BONE_INDEX.CENTER, flags: 0x001a, tailOffset: [0, 1, 0] },
  ];

  const writer = new BinaryWriter();
  writer.bytes(Buffer.from("PMX ", "ascii"));
  writer.f32(2.0);
  writer.u8(8);
  writer.bytes(Buffer.from([0, 0, 4, 1, 1, 1, 1, 1]));
  writer.text(BILLBOARD_VARIANT
    ? "モブフェス・ペンライト4000 ビルボード軽量版"
    : OPTIMIZED_VARIANT
      ? "モブフェス・ペンライト4000 高速化版"
      : "モブフェス・ペンライト4000");
  writer.text(BILLBOARD_VARIANT
    ? "MobFesPenlight_3"
    : OPTIMIZED_VARIANT
      ? "MobFesPenlight_2"
      : "MobFesPenlight");
  writer.text(BILLBOARD_VARIANT
    ? "遠景向けビルボード軽量版。同名のMobFesPenlight_3.fxdayoを適用してください。"
    : OPTIMIZED_VARIANT
      ? "GPU負荷軽減版。同名のMobFesPenlight_2.fxdayoを適用してください。"
      : "観客の身体を含まないペンライト専用モデル。同名fxdayoを適用してください。");
  writer.text(BILLBOARD_VARIANT
    ? "Billboard low-load edition. Apply MobFesPenlight_3.fxdayo."
    : OPTIMIZED_VARIANT
      ? "GPU-optimized edition. Apply MobFesPenlight_2.fxdayo."
      : "Penlight-only crowd model. Apply the matching fxdayo in MikuMikuDayo.");

  writer.i32(geometry.vertices.length);
  for (const vertex of geometry.vertices) {
    writer.f32Array(vertex.position);
    writer.f32Array(vertex.normal);
    writer.f32Array(vertex.uv);
    writer.u8(0);
    writer.i8(vertex.bone);
    writer.f32(1.0);
  }

  writer.i32(allIndices.length);
  for (const index of allIndices) writer.u32(index);

  writer.i32(0);
  writer.i32(materials.length);
  for (const material of materials) writeMaterial(writer, material);

  writer.i32(bones.length);
  for (const bone of bones) writeBone(writer, bone);

  writer.i32(morphs.length);
  for (const morph of morphs) writeMorph(writer, morph);

  writer.i32(9);
  writeDisplayFrame(writer, "Root", "Root", 1, [[0, BONE_INDEX.ROOT]]);
  // HOW: センターボーンを独立枠に表示し、MMD上で選択して移動できるようにする。
  writeDisplayFrame(writer, "センター", "Center", 0, [[0, BONE_INDEX.CENTER]]);
  writeDisplayFrame(
    writer,
    "表情",
    "Facial",
    1,
    morphs.map((_, index) => [1, index]),
  );
  for (let groupIndex = 0; groupIndex < GLOW_GROUPS.length; groupIndex += 1) {
    const firstMorph = groupIndex * 11;
    writeDisplayFrame(
      writer,
      GLOW_GROUPS[groupIndex].jp,
      GLOW_GROUPS[groupIndex].en,
      0,
      Array.from({ length: 11 }, (_, localIndex) => [1, firstMorph + localIndex]),
    );
  }
  writeDisplayFrame(
    writer,
    "動き・配置",
    "MotionAndLayout",
    0,
    [
      [1, 44], [1, 45], [1, 46], [1, 47], [1, 48], [1, 49],
      [1, 50], [1, 51], [1, 52], [1, 53], [1, 54], [1, 55],
    ],
  );
  writeDisplayFrame(
    writer,
    "ペンライト",
    "Penlight",
    0,
    [[0, BONE_INDEX.PENLIGHT_A], [0, BONE_INDEX.PENLIGHT_B]],
  );

  writer.i32(0);
  writer.i32(0);
  writer.save(OUTPUT_PATH);

  return {
    instances: INSTANCE_COUNT,
    verticesPerInstance: geometry.verticesPerInstance,
    vertices: geometry.vertices.length,
    indices: allIndices.length,
    materials: materials.length,
    bones: bones.length,
    morphs: morphs.length,
    bytes: writer.offset,
  };
}


const summary = generate();
console.log(`created: ${OUTPUT_PATH}`);
for (const [key, value] of Object.entries(summary)) console.log(`${key}: ${value}`);
