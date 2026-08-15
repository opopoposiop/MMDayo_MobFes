/**
 * What: 通常版とGPU負荷軽減版のPMX・fxdayo対応関係を検査する。
 * 非エンジニア向けには、最後に「VALID」と表示されれば構造検証に成功した状態。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


// =============================================================================
// ユーザーが変更してよい箇所
// =============================================================================
// What: 成果物名を変更した場合だけ、対応する組の名前を一緒に変更する。
const ARTIFACTS = [
  {
    name: "通常版",
    pmxName: "archive/MobFesPenlight.pmx",
    fxName: "archive/MobFesPenlight.fxdayo",
    optimized: false,
  },
  {
    name: "GPU負荷軽減版",
    pmxName: "archive/MobFesPenlight_2.pmx",
    fxName: "archive/MobFesPenlight_2.fxdayo",
    optimized: true,
    billboard: false,
  },
  {
    name: "ビルボード軽量版",
    pmxName: "MobFesPenlight_3.pmx",
    fxName: "MobFesPenlight_3.fxdayo",
    optimized: true,
    billboard: true,
  },
];


// =============================================================================
// ユーザー変更不可の箇所
// =============================================================================
// Why not: 読み飛ばすバイト数はPMX仕様そのものなので、変更すると誤判定する。
// Codex用覚書: 現成果物が使うPMX 2.0の要素に加え、一般的な可変長項目も読む。

const HERE = path.dirname(fileURLToPath(import.meta.url));


class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  need(count) {
    if (this.offset + count > this.buffer.length) {
      throw new Error(`PMXが途中で終わっています: offset=${this.offset}, need=${count}`);
    }
  }

  skip(count) {
    this.need(count);
    this.offset += count;
  }

  u8() {
    this.need(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  i8() {
    this.need(1);
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u16() {
    this.need(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  i32() {
    this.need(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  f32() {
    this.need(4);
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  f32Array(count) {
    return Array.from({ length: count }, () => this.f32());
  }

  text(encoding) {
    const byteLength = this.i32();
    if (byteLength < 0) throw new Error("文字列長が負数です");
    this.need(byteLength);
    const value = this.buffer.subarray(this.offset, this.offset + byteLength)
      .toString(encoding === 0 ? "utf16le" : "utf8");
    this.offset += byteLength;
    return value;
  }

  index(size, signed = true) {
    this.need(size);
    let value;
    if (size === 1) value = signed ? this.buffer.readInt8(this.offset) : this.buffer.readUInt8(this.offset);
    else if (size === 2) value = signed ? this.buffer.readInt16LE(this.offset) : this.buffer.readUInt16LE(this.offset);
    else if (size === 4) value = signed ? this.buffer.readInt32LE(this.offset) : this.buffer.readUInt32LE(this.offset);
    else throw new Error(`未対応の索引サイズ: ${size}`);
    this.offset += size;
    return value;
  }
}


function assert(condition, message) {
  if (!condition) throw new Error(message);
}


// What: PMXを先頭から末尾まで読み、件数、名称、索引、終端位置を確認する。
function parsePmx(filename) {
  const reader = new Reader(fs.readFileSync(filename));
  assert(reader.buffer.subarray(0, 4).toString("ascii") === "PMX ", "PMX署名がありません");
  reader.skip(4);
  const version = reader.f32();
  assert(Math.abs(version - 2.0) < 0.001, `PMX 2.0ではありません: ${version}`);
  const headerSize = reader.u8();
  assert(headerSize === 8, `PMXヘッダーサイズが不正です: ${headerSize}`);
  const encoding = reader.u8();
  const additionalUv = reader.u8();
  const vertexIndexSize = reader.u8();
  const textureIndexSize = reader.u8();
  const materialIndexSize = reader.u8();
  const boneIndexSize = reader.u8();
  const morphIndexSize = reader.u8();
  const rigidIndexSize = reader.u8();

  const modelName = reader.text(encoding);
  reader.text(encoding);
  reader.text(encoding);
  reader.text(encoding);

  const vertexCount = reader.i32();
  assert(vertexCount > 0, "頂点がありません");
  const weightedBoneIndices = new Set();
  for (let i = 0; i < vertexCount; i += 1) {
    reader.skip(12 + 12 + 8 + additionalUv * 16);
    const weightType = reader.u8();
    if (weightType === 0) weightedBoneIndices.add(reader.index(boneIndexSize));
    else if (weightType === 1) {
      weightedBoneIndices.add(reader.index(boneIndexSize));
      weightedBoneIndices.add(reader.index(boneIndexSize));
      reader.skip(4);
    } else if (weightType === 2 || weightType === 4) {
      for (let j = 0; j < 4; j += 1) weightedBoneIndices.add(reader.index(boneIndexSize));
      reader.skip(16);
    } else if (weightType === 3) {
      weightedBoneIndices.add(reader.index(boneIndexSize));
      weightedBoneIndices.add(reader.index(boneIndexSize));
      reader.skip(4 + 36);
    } else {
      throw new Error(`未対応のウェイト種別: ${weightType}`);
    }
    reader.skip(4);
  }

  const indexCount = reader.i32();
  assert(indexCount % 3 === 0, "面索引数が3の倍数ではありません");
  let maxVertexIndex = -1;
  for (let i = 0; i < indexCount; i += 1) {
    maxVertexIndex = Math.max(maxVertexIndex, reader.index(vertexIndexSize, false));
  }
  assert(maxVertexIndex < vertexCount, "面が存在しない頂点を参照しています");

  const textureCount = reader.i32();
  for (let i = 0; i < textureCount; i += 1) reader.text(encoding);

  const materialCount = reader.i32();
  let materialIndexTotal = 0;
  const materials = [];
  for (let i = 0; i < materialCount; i += 1) {
    const name = reader.text(encoding);
    reader.text(encoding);
    const diffuse = reader.f32Array(4);
    const specular = reader.f32Array(3);
    const shininess = reader.f32();
    const ambient = reader.f32Array(3);
    reader.skip(1 + 16 + 4);
    reader.index(textureIndexSize);
    reader.index(textureIndexSize);
    reader.skip(1);
    const sharedToon = reader.u8();
    if (sharedToon === 0) reader.index(textureIndexSize);
    else reader.skip(1);
    reader.text(encoding);
    const materialIndexCount = reader.i32();
    materialIndexTotal += materialIndexCount;
    materials.push({
      name,
      diffuse,
      specular,
      shininess,
      ambient,
      indexCount: materialIndexCount,
    });
  }
  assert(materialIndexTotal === indexCount, "材質ごとの面索引数合計が一致しません");

  const boneCount = reader.i32();
  const bones = [];
  for (let i = 0; i < boneCount; i += 1) {
    const name = reader.text(encoding);
    const nameEn = reader.text(encoding);
    const position = reader.f32Array(3);
    const parent = reader.index(boneIndexSize);
    const transformLayer = reader.i32();
    const flags = reader.u16();
    if (flags & 0x0001) reader.index(boneIndexSize);
    else reader.skip(12);
    if (flags & 0x0100 || flags & 0x0200) {
      reader.index(boneIndexSize);
      reader.skip(4);
    }
    if (flags & 0x0400) reader.skip(12);
    if (flags & 0x0800) reader.skip(24);
    if (flags & 0x2000) reader.skip(4);
    if (flags & 0x0020) {
      reader.index(boneIndexSize);
      reader.i32();
      reader.f32();
      const linkCount = reader.i32();
      for (let j = 0; j < linkCount; j += 1) {
        reader.index(boneIndexSize);
        if (reader.u8()) reader.skip(24);
      }
    }
    bones.push({ name, nameEn, position, parent, transformLayer, flags });
  }

  const morphCount = reader.i32();
  const morphNames = [];
  const morphPanels = {};
  for (let i = 0; i < morphCount; i += 1) {
    const morphName = reader.text(encoding);
    morphNames.push(morphName);
    reader.text(encoding);
    morphPanels[morphName] = reader.u8();
    const type = reader.u8();
    const itemCount = reader.i32();
    for (let j = 0; j < itemCount; j += 1) {
      if (type === 0) {
        reader.index(morphIndexSize);
        reader.skip(4);
      } else if (type === 1) {
        reader.index(vertexIndexSize);
        reader.skip(12);
      } else if (type === 2) {
        reader.index(boneIndexSize);
        reader.skip(28);
      } else if (type >= 3 && type <= 7) {
        reader.index(vertexIndexSize);
        reader.skip(16);
      } else if (type === 8) {
        reader.index(materialIndexSize);
        reader.skip(1 + 112);
      } else {
        throw new Error(`未対応のモーフ種別: ${type}`);
      }
    }
  }

  const displayCount = reader.i32();
  const displayFrames = [];
  for (let i = 0; i < displayCount; i += 1) {
    const name = reader.text(encoding);
    const nameEn = reader.text(encoding);
    const special = reader.u8();
    const elementCount = reader.i32();
    const elements = [];
    for (let j = 0; j < elementCount; j += 1) {
      const type = reader.u8();
      const index = reader.index(type === 0 ? boneIndexSize : morphIndexSize);
      elements.push({ type, index });
    }
    displayFrames.push({ name, nameEn, special, elements });
  }

  const rigidCount = reader.i32();
  for (let i = 0; i < rigidCount; i += 1) {
    reader.text(encoding);
    reader.text(encoding);
    reader.index(boneIndexSize);
    reader.skip(1 + 2 + 1 + 12 + 12 + 12 + 4 * 5 + 1);
  }
  const jointCount = reader.i32();
  for (let i = 0; i < jointCount; i += 1) {
    reader.text(encoding);
    reader.text(encoding);
    reader.skip(1);
    reader.index(rigidIndexSize);
    reader.index(rigidIndexSize);
    reader.skip(12 * 8);
  }

  assert(reader.offset === reader.buffer.length, `PMX末尾に未解析データがあります: ${reader.buffer.length - reader.offset} bytes`);
  return {
    version,
    modelName,
    vertexCount,
    indexCount,
    materialCount,
    materials,
    boneCount,
    bones,
    weightedBoneIndices: [...weightedBoneIndices].sort((a, b) => a - b),
    morphCount,
    morphNames,
    morphPanels,
    displayFrames,
    bytes: reader.buffer.length,
  };
}


// What: 全ての親とセンターが移動可能で、全頂点へ親子階層が伝播するか検査する。
function validateMovableBones(pmx) {
  const rootIndex = pmx.bones.findIndex((bone) => bone.name === "全ての親");
  const centerIndex = pmx.bones.findIndex((bone) => bone.name === "センター");
  const controlIndex = pmx.bones.findIndex((bone) => bone.name === "制御");
  const penlightIndices = ["ペンライトA", "ペンライトB"]
    .map((name) => pmx.bones.findIndex((bone) => bone.name === name));

  assert(rootIndex >= 0, "「全ての親」ボーンがありません");
  assert(centerIndex >= 0, "「センター」ボーンがありません");
  assert(controlIndex >= 0, "「制御」ボーンがありません");
  assert(penlightIndices.every((index) => index >= 0), "ペンライト用ボーンが不足しています");
  assert(pmx.bones[rootIndex].parent === -1, "「全ての親」が最上位ボーンではありません");
  assert(pmx.bones[centerIndex].parent === rootIndex, "「センター」が「全ての親」の子ではありません");
  assert(pmx.bones[controlIndex].parent === centerIndex, "「制御」が「センター」の子ではありません");
  for (const index of penlightIndices) {
    assert(pmx.bones[index].parent === centerIndex,
      `${pmx.bones[index].name}が「センター」の子ではありません`);
  }

  const movableFlags = 0x001e;
  for (const index of [rootIndex, centerIndex]) {
    assert((pmx.bones[index].flags & movableFlags) === movableFlags,
      `${pmx.bones[index].name}に回転・移動・表示・操作許可がありません`);
  }
  assert(pmx.weightedBoneIndices.length === 2
    && penlightIndices.every((index) => pmx.weightedBoneIndices.includes(index)),
  "全頂点がペンライト用ボーンへ正しく割り当てられていません");

  const rootFrame = pmx.displayFrames.find((frame) => frame.name === "Root");
  const centerFrame = pmx.displayFrames.find((frame) => frame.name === "センター");
  assert(rootFrame?.elements.some((element) => element.type === 0 && element.index === rootIndex),
    "Root表示枠に「全ての親」がありません");
  assert(centerFrame?.elements.some((element) => element.type === 0 && element.index === centerIndex),
    "センター表示枠に「センター」ボーンがありません");
}


// What: 4色の材質が同時表示でき、MMDayo_AL方式Aの判定条件を満たすか検査する。
function validateMmdDayoAl(pmx) {
  const glowMaterials = pmx.materials.filter((material) => material.name.startsWith("発光部_色"));
  assert(glowMaterials.length === 4, `発光材質が4系統ではありません: ${glowMaterials.length}`);
  const baseColors = new Set();
  for (const material of glowMaterials) {
    const specularMax = Math.max(...material.specular);
    assert(specularMax <= 0.05, `${material.name}のスペキュラ色がMMDayo_AL閾値を超えています`);
    assert(material.shininess >= 100, `${material.name}のShininessがMMDayo_AL閾値未満です`);
    assert(material.indexCount > 0, `${material.name}に面が割り当てられていません`);
    baseColors.add(material.diffuse.slice(0, 3).map((value) => value.toFixed(3)).join(","));
  }
  assert(baseColors.size === 4, "4つの発光材質の初期色が重複しています");

  for (let group = 1; group <= 4; group += 1) {
    assert(pmx.morphNames.includes(`色${group}_AL強度`), `色${group}のAL強度モーフがありません`);
    assert(pmx.morphNames.includes(`色${group}_H赤`), `色${group}の独立色相モーフがありません`);
    assert(pmx.morphNames.includes(`色${group}_S0`), `色${group}の独立彩度モーフがありません`);
    assert(pmx.morphNames.includes(`色${group}_V50`), `色${group}の独立明度モーフがありません`);
    const colorMorphNames = pmx.morphNames.filter((name) => new RegExp(`^色${group}_(H|S|V)`).test(name));
    assert(colorMorphNames.length === 10, `色${group}の色関係モーフ数が10ではありません`);
    for (const name of colorMorphNames) {
      assert(pmx.morphPanels[name] === 2, `${name}が「目」分類ではありません`);
    }
    assert(pmx.morphPanels[`色${group}_AL強度`] === 3, `色${group}のAL強度モーフが「リップ」分類ではありません`);
  }
  assert(pmx.morphPanels["AL消灯_全体"] === 3, "全体消灯モーフが「リップ」分類ではありません");
  assert(pmx.morphNames.includes("Yゆらぎ"), "Y軸ゆらぎモーフがありません");
  assert(pmx.morphNames.includes("ゆらぎ停止"), "ゆらぎ停止モーフがありません");
  assert(pmx.morphNames.includes("同調"), "観客動作の同調モーフがありません");
  for (const axis of ["X", "Y", "Z"]) {
    assert(pmx.morphNames.includes(`${axis}振幅`), `${axis}軸の独立振幅モーフがありません`);
  }
}


// What: YRZFX JSONが構文上正しく、PMXの制御モーフを正しく参照するか確認する。
function parseFx(filename, pmx, optimized, billboard = false) {
  const source = fs.readFileSync(filename, "utf8");
  const match = source.match(/\[YRZFX\]\s*([\s\S]*?)\s*\[HLSL\]/);
  assert(match, "YRZFX JSONブロックがありません");
  const metadata = JSON.parse(match[1]);
  assert(metadata.fx.category === "deform", "fxdayoのcategoryがdeformではありません");
  assert(metadata.fx.passes?.some((pass) => pass.computeShader === "CS"), "CSパスがありません");
  for (const controller of metadata.fx.controllers ?? []) {
    assert(pmx.morphNames.includes(controller.item), `PMXに制御モーフ「${controller.item}」がありません`);
  }

  const instanceCount = Number(source.match(/#define\s+MOB_INSTANCE_COUNT\s+(\d+)/)?.[1]);
  const verticesPerInstance = Number(source.match(/#define\s+MOB_VERTICES_PER_INSTANCE\s+(\d+)/)?.[1]);
  const totalVertexCount = Number(source.match(/#define\s+MOB_TOTAL_VERTEX_COUNT\s+(\d+)/)?.[1]);
  const areaWidth = Number(source.match(/#define\s+USER_AREA_WIDTH\s+([\d.]+)/)?.[1]);
  const areaDepth = Number(source.match(/#define\s+USER_AREA_DEPTH\s+([\d.]+)/)?.[1]);
  const areaMorphMaxScale = Number(source.match(/#define\s+USER_AREA_MORPH_MAX_SCALE\s+([\d.]+)/)?.[1]);
  const gravityAcceleration = Number(source.match(/#define\s+USER_GRAVITY_ACCELERATION\s+([\d.]+)/)?.[1]);
  const tempoMinBpm = Number(source.match(/#define\s+USER_TEMPO_MIN_BPM\s+([\d.]+)/)?.[1]);
  const tempoMaxBpm = Number(source.match(/#define\s+USER_TEMPO_MAX_BPM\s+([\d.]+)/)?.[1]);
  const swingXScale = Number(source.match(/#define\s+USER_SWING_X_SCALE\s+([\d.]+)/)?.[1]);
  const swingYScale = Number(source.match(/#define\s+USER_SWING_Y_SCALE\s+([\d.]+)/)?.[1]);
  const swingZScale = Number(source.match(/#define\s+USER_SWING_Z_SCALE\s+([\d.]+)/)?.[1]);
  assert(instanceCount * verticesPerInstance === totalVertexCount, "fxdayo内の頂点数定数が一致しません");
  assert(totalVertexCount === pmx.vertexCount, "PMX頂点数とfxdayo総頂点数が一致しません");
  assert(Math.abs(areaWidth * areaDepth - 80 * 56 * 2) < 1.0, "初期配置面積が従来値の2倍ではありません");
  assert(areaMorphMaxScale === 3.0, "配置幅・配置奥行のモーフ最大値が3倍ではありません");
  assert(Math.abs(gravityAcceleration - 9.80665) < 1.0e-5, "標準重力加速度が設定されていません");
  assert(tempoMinBpm === 60 && tempoMaxBpm === 240,
    "テンポモーフの範囲が60～240 BPMではありません");
  assert((source.match(/float bpm = MobTempoBpm\(\);/g) ?? []).length === 2,
    "三軸回転とジャンプが共通BPM関数を使用していません");
  assert(swingXScale === 3 && swingYScale === 5 && swingZScale === 3,
    "X/Y/Z軸の基準振れ幅が3倍/5倍/3倍ではありません");
  assert(source.includes("C_YBob"), "fxdayoにY軸ゆらぎ制御がありません");
  assert(source.includes("C_StopMotion"), "fxdayoにゆらぎ停止制御がありません");
  assert(source.includes("C_Sync"), "fxdayoに観客動作の同調制御がありません");
  assert(source.includes("instanceIndex / 64u"), "同調動作が小グループ単位になっていません");
  assert(source.includes("MobSyncWeight"), "同調0～1に漸進補間カーブがありません");
  assert(source.includes("1.0 - (1.0 - x) * (1.0 - x)"),
    "同調が低いモーフ値から効く減速カーブではありません");
  assert(source.includes("MobBlendAngle(randomPhase, concertPhase, sync)"),
    "三軸回転の位相が最短方向で補間されていません");
  assert(source.includes("MobBlendCycle(randomValue.w, groupCyclePhase, sync)"),
    "ジャンプ位相が周期境界を考慮して補間されていません");
  for (const axis of ["X", "Y", "Z"]) {
    assert(source.includes(`C_${axis}SwingAmp`), `fxdayoに${axis}軸の独立振幅制御がありません`);
    assert(source.includes(`${axis.toLowerCase()}AmplitudeControl`),
      `${axis}軸の独立振幅値が回転計算へ適用されていません`);
  }
  assert((source.match(/saturate\(1\.0 - C_StopMotion\)/g) ?? []).length >= 2,
    "ゆらぎ停止が三軸回転とY上下動の両方へ適用されていません");
  assert(source.includes("initialVelocity * elapsed - 0.5 * gravity * elapsed * elapsed"),
    "Y軸ゆらぎが重力加速度による放物運動ではありません");
  assert(source.includes("MobHumanJump"), "Y軸ゆらぎに人間型ジャンプ関数がありません");
  for (const phaseName of ["crouchEnd", "takeoffPhase", "landingPhase", "landingCrouchEnd"]) {
    assert(source.includes(phaseName), `人間型ジャンプに${phaseName}段階がありません`);
  }
  const placementExpression = optimized
    ? "vertex.position += G_InstancePosition"
    : "vertex.position += MobPosition";
  const placementIndex = source.indexOf(placementExpression);
  const skinningIndex = source.indexOf("Dayo::LBS(vertex, Dayo::Skin[vertexIndex], 1)");
  assert(source.includes("Dayo::VB[vertexIndex]"), "ボーン変換前の頂点を読み込んでいません");
  assert(placementIndex >= 0 && skinningIndex > placementIndex,
    "会場配置後にボーンスキニングを適用していません");
  if (!billboard) {
    assert(source.includes("YRZ::ComputeTBN(vertex.normal)"),
      "ボーン変換前の接線を初期化していません");
  }
  assert(source.includes("Dayo::OutBuf"), "変形結果の出力処理がありません");

  if (optimized) {
    // What: 26頂点の個体計算共有と三角関数キャッシュが有効か検査する。
    const mainPass = metadata.fx.passes.find((pass) => pass.name === "Main");
    assert(mainPass?.numthreads?.x === verticesPerInstance,
      "高速化版のスレッドグループ幅が1本分の頂点数と一致しません");
    assert(totalVertexCount % mainPass.numthreads.x === 0,
      "高速化版の総頂点数がスレッドグループ幅で割り切れません");
    assert(source.includes("SV_GroupThreadID"), "高速化版がグループ内頂点番号を使用していません");
    assert(source.includes("groupshared float3 G_InstancePosition"),
      "高速化版に個体位置の共有領域がありません");
    assert(source.includes("GroupMemoryBarrierWithGroupSync"),
      "高速化版に共有値の同期処理がありません");
    assert(source.includes("groupThreadId.x == 0u"),
      "高速化版が個体計算をグループ先頭へ限定していません");
    assert((source.match(/sincos\(/g) ?? []).length === 3,
      "高速化版の回転三角関数がX・Y・Zの3回に集約されていません");
    if (!billboard) {
      assert((source.match(/MobRotateCached\(vertex\./g) ?? []).length === 3,
        "高速化版が位置・法線・接線で共有回転値を再利用していません");
    }
    assert(source.includes("if (yBobWeight > 0.0 && motionWeight > 0.0)"),
      "高速化版がYゆらぎ0の不要なジャンプ計算を省略していません");
    assert(source.includes("if (C_StopMotion >= 1.0)"),
      "高速化版が停止中の不要な周期計算を省略していません");
  }

  if (billboard) {
    // What: 4000本が8頂点・4三角形のカメラ向き板として構成されるか検査する。
    assert(verticesPerInstance === 8, "ビルボード版が1本8頂点ではありません");
    assert(pmx.vertexCount === instanceCount * 8,
      "ビルボード版の総頂点数が4000本×8頂点ではありません");
    assert(pmx.indexCount / 3 === instanceCount * 4,
      "ビルボード版の三角形数が4000本×4ではありません");
    for (const sharedName of [
      "G_BillboardRight",
      "G_BillboardUp",
      "G_BillboardNormal",
    ]) {
      assert(source.includes(`groupshared float3 ${sharedName}`),
        `ビルボード版に共有基底${sharedName}がありません`);
    }
    assert(source.includes("Dayo::CameraForward") && source.includes("Dayo::CameraRight"),
      "ビルボード版がカメラ方向を参照していません");
    assert(source.includes("MobRotateCached(")
      && source.includes("float3(0.0, 1.0, 0.0)"),
    "ビルボード版の縦軸に振り動作が適用されていません");
    assert(source.includes("G_BillboardRight * localPosition.x")
      && source.includes("G_BillboardUp * localPosition.y")
      && source.includes("G_BillboardNormal * localPosition.z"),
    "ビルボード版が共有基底から頂点位置を構築していません");
    assert(source.includes("vertex.normal = G_BillboardNormal")
      && source.includes("vertex.tangent = G_BillboardRight"),
    "ビルボード版の法線・接線が板面へ一致していません");
  }

  return {
    optimized,
    billboard,
    controllers: metadata.fx.controllers.length,
    instanceCount,
    verticesPerInstance,
    areaWidth,
    areaDepth,
    area: areaWidth * areaDepth,
    areaMorphMaxScale,
    gravityAcceleration,
    tempoBpm: [tempoMinBpm, tempoMaxBpm],
    swingScale: [swingXScale, swingYScale, swingZScale],
    instanceEvaluationDivisor: optimized ? verticesPerInstance : 1,
  };
}


const results = [];
for (const artifact of ARTIFACTS) {
  const pmx = parsePmx(path.join(HERE, artifact.pmxName));
  validateMovableBones(pmx);
  validateMmdDayoAl(pmx);
  const fx = parseFx(
    path.join(HERE, artifact.fxName),
    pmx,
    artifact.optimized,
    artifact.billboard,
  );
  results.push({
    name: artifact.name,
    files: [artifact.pmxName, artifact.fxName],
    pmx: {
      modelName: pmx.modelName,
      vertexCount: pmx.vertexCount,
      triangleCount: pmx.indexCount / 3,
      materialCount: pmx.materialCount,
      boneCount: pmx.boneCount,
      morphCount: pmx.morphCount,
      bytes: pmx.bytes,
    },
    fx,
  });
}
console.log("VALID");
console.log(JSON.stringify({ artifacts: results }, null, 2));
