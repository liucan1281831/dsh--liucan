/**
 * Live2D 模型包解析离线测试。
 *
 * 不联网、不写磁盘：zip 由测试内部现场构造，覆盖路径穿越、缺文件、
 * Cubism 2 拒绝、元数据提取、幂等 id 等关键行为。
 *
 * 运行：node --test lib/live2d.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Live2DError,
  MAX_ENTRY_BYTES,
  extractZipFiles,
  findFile,
  locateCubismModel,
  prepareModelPackage,
  readZipEntries,
  sanitizeModelName,
  sanitizeZipPath,
} from './live2d-package.js'
import { makeZip } from './test-zip.js'

// ==================== 测试夹具 ====================

const MODEL_JSON = {
  Version: 3,
  FileReferences: {
    Moc: 'model.moc3',
    Textures: ['textures/tex_00.png'],
    Physics: 'model.physics3.json',
    Motions: {
      Idle: [{ File: 'motions/idle.motion3.json' }, { File: 'motions/idle2.motion3.json' }],
      TapHead: [{ File: 'motions/tap.motion3.json' }],
    },
    Expressions: [{ Name: '开心', File: 'expressions/happy.exp3.json' }],
  },
  HitAreas: [{ Id: 'HitAreaHead', Name: 'Head' }],
}

function makeModelFiles(prefix = 'haru/') {
  return [
    { path: `${prefix}model.model3.json`, data: JSON.stringify(MODEL_JSON) },
    { path: `${prefix}model.moc3`, data: Buffer.from('MO3FAKE') },
    { path: `${prefix}textures/tex_00.png`, data: Buffer.from('89504e470d0a1a0a', 'hex') },
    { path: `${prefix}model.physics3.json`, data: '{}' },
    { path: `${prefix}motions/idle.motion3.json`, data: '{}' },
    { path: `${prefix}motions/idle2.motion3.json`, data: '{}' },
    { path: `${prefix}motions/tap.motion3.json`, data: '{}' },
    { path: `${prefix}expressions/happy.exp3.json`, data: '{}' },
  ]
}

// ==================== 基础解析 ====================

test('readZipEntries 能读出 store 与 deflate 两种条目', () => {
  for (const method of [0, 8]) {
    const zip = makeZip([{ path: 'a/b.txt', data: 'hello' }], { method })
    const entries = readZipEntries(zip)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, 'a/b.txt')
    assert.equal(entries[0].method, method)
    assert.equal(entries[0].uncompressedSize, 5)
  }
})

test('extractZipFiles 解出文件并跳过 __MACOSX / .DS_Store', () => {
  const zip = makeZip([
    ...makeModelFiles(''),
    { path: '__MACOSX/._model.moc3', data: 'junk' },
    { path: '.DS_Store', data: 'junk' },
  ])
  const files = extractZipFiles(zip)
  const paths = files.map(file => file.path)
  assert.ok(paths.includes('model.model3.json'))
  assert.ok(!paths.includes('.DS_Store'))
  assert.ok(!paths.some(path => path.startsWith('__MACOSX/')))
  assert.equal(findFile(files, 'MODEL.MOC3')?.path, 'model.moc3', '大小写不敏感兜底')
})

test('extractZipFiles 拒绝路径穿越与绝对路径', () => {
  for (const bad of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/win.txt']) {
    const zip = makeZip([{ path: bad, data: 'x' }])
    assert.throws(
      () => extractZipFiles(zip),
      error => error instanceof Live2DError && error.code === 'BAD_PATH',
      `应拒绝 ${bad}`,
    )
  }
})

test('extractZipFiles 拒绝重复路径', () => {
  const zip = makeZip([
    { path: 'a.txt', data: '1' },
    { path: 'a.txt', data: '2' },
  ])
  assert.throws(() => extractZipFiles(zip), error => error.code === 'DUPLICATE_FILE')
})

test('extractZipFiles 拒绝声明体积过大的条目（zip 炸弹防护）', () => {
  const zip = makeZip([{ path: 'huge.bin', data: Buffer.alloc(64) }])
  // 直接篡改中央目录里的 uncompressedSize：定位 sig 后写一个超大值
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  zip.writeUInt32LE(MAX_ENTRY_BYTES + 1, central + 24)
  assert.throws(() => extractZipFiles(zip), error => error.code === 'TOO_LARGE')
})

test('sanitizeZipPath 规范化反斜杠与 ./', () => {
  assert.equal(sanitizeZipPath('a\\b\\c.png'), 'a/b/c.png')
  assert.equal(sanitizeZipPath('./a//b.png'), 'a/b.png')
  assert.throws(() => sanitizeZipPath(''), error => error.code === 'BAD_PATH')
  assert.throws(() => sanitizeZipPath('a/\u0001b.png'), error => error.code === 'BAD_PATH')
})

// ==================== 模型定位与校验 ====================

test('locateCubismModel 找到嵌套 model3.json 并提取元数据', () => {
  const files = extractZipFiles(makeZip(makeModelFiles('haru/')))
  const model = locateCubismModel(files)
  assert.equal(model.modelJsonPath, 'haru/model.model3.json')
  assert.equal(model.modelDir, 'haru')
  assert.equal(model.version, '4')
  assert.equal(model.textureCount, 1)
  assert.equal(model.hasPhysics, true)
  assert.deepEqual(model.motions, [
    { name: 'Idle', count: 2 },
    { name: 'TapHead', count: 1 },
  ])
  assert.deepEqual(model.expressionNames, ['开心'])
})

test('locateCubismModel 多个模型时选层级最浅的', () => {
  const deep = makeModelFiles('pack/inner/')
  const shallow = makeModelFiles('')
  const files = extractZipFiles(makeZip([...deep, ...shallow]))
  const model = locateCubismModel(files)
  assert.equal(model.modelJsonPath, 'model.model3.json')
})

test('locateCubismModel 对 Cubism 2 模型给出明确错误', () => {
  const files = extractZipFiles(makeZip([{ path: 'shizuku.model.json', data: '{}' }]))
  assert.throws(
    () => locateCubismModel(files),
    error => error.code === 'CUBISM2_UNSUPPORTED',
  )
})

test('locateCubismModel 在没有 model3.json 时报 NO_MODEL_FILE', () => {
  const files = extractZipFiles(makeZip([{ path: 'readme.txt', data: 'hi' }]))
  assert.throws(() => locateCubismModel(files), error => error.code === 'NO_MODEL_FILE')
})

test('locateCubismModel 检查 moc3 与贴图是否齐全', () => {
  const missingMoc = [
    { path: 'model.model3.json', data: JSON.stringify(MODEL_JSON) },
    { path: 'textures/tex_00.png', data: 'x' },
  ]
  assert.throws(
    () => locateCubismModel(extractZipFiles(makeZip(missingMoc))),
    error => error.code === 'MODEL_INCOMPLETE' && error.message.includes('moc3'),
  )

  const missingTexture = [
    { path: 'model.model3.json', data: JSON.stringify(MODEL_JSON) },
    { path: 'model.moc3', data: 'x' },
  ]
  assert.throws(
    () => locateCubismModel(extractZipFiles(makeZip(missingTexture))),
    error => error.code === 'MODEL_INCOMPLETE' && error.message.includes('贴图'),
  )
})

test('locateCubismModel 拒绝损坏的 model3.json', () => {
  const files = extractZipFiles(makeZip([
    { path: 'model.model3.json', data: '{not json' },
    { path: 'model.moc3', data: 'x' },
  ]))
  assert.throws(() => locateCubismModel(files), error => error.code === 'BAD_MODEL_JSON')
})

test('locateCubismModel 容忍贴图路径大小写不一致', () => {
  const files = extractZipFiles(makeZip([
    { path: 'model.model3.json', data: JSON.stringify(MODEL_JSON) },
    { path: 'model.moc3', data: 'x' },
    { path: 'Textures/TEX_00.PNG', data: 'x' },
  ]))
  const model = locateCubismModel(files)
  assert.equal(model.textureCount, 1)
})

// ==================== 模型包 ====================

test('prepareModelPackage 生成稳定 id 与完整元数据', () => {
  const zip = makeZip(makeModelFiles(''))
  const first = prepareModelPackage(zip, { fallbackName: 'haru' })
  const second = prepareModelPackage(zip, { fallbackName: 'haru' })
  assert.match(first.id, /^l2d-[a-z0-9]{12}$/)
  assert.equal(first.id, second.id, '同一份模型重复上传应得到同一 id')
  assert.equal(first.name, 'haru')
  assert.equal(first.meta.version, '4')
  assert.equal(first.meta.textureCount, 1)
  assert.equal(first.meta.fileCount, first.files.length)
  assert.ok(first.meta.size > 0)
  assert.equal(first.meta.modelJsonPath, 'model.model3.json')
})

test('prepareModelPackage 名称不同则 id 不同', () => {
  const zip = makeZip(makeModelFiles(''))
  const a = prepareModelPackage(zip, { fallbackName: 'A' })
  const b = prepareModelPackage(zip, { fallbackName: 'B' })
  assert.notEqual(a.id, b.id)
})

test('sanitizeModelName 清洗控制字符并限长', () => {
  assert.equal(sanitizeModelName('  我\u0000的  模型  '), '我 的 模型')
  assert.equal(sanitizeModelName(''), 'Live2D 模型')
  assert.equal(sanitizeModelName('x'.repeat(80)).length, 48)
})
