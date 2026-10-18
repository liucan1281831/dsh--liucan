/**
 * Live2D 模型包解析（纯逻辑，不碰文件系统）。
 *
 * 设计目标：
 *  - 用户上传一个 zip，里面是 Cubism 3/4 模型（model3.json + moc3 + 贴图 + 动作）；
 *  - 在入库前完成全部校验：路径穿越、zip 炸弹、缺文件、版本不支持，一律结构化报错；
 *  - 只做「内存里的 zip → 文件列表 + 元数据」，落盘由 index.js 负责，便于离线单测。
 *
 * 为什么自己解析 zip：插件不希望引入第三方依赖（原先连数据库都没有），
 * 而 Node 自带的 zlib 已能解 deflate，中央目录解析只需要百来行。
 * 只支持单卷、非加密、deflate/store 两种压缩方式——这正是模型包的实际形态。
 *
 * 安全约定：zip 条目名来自外部输入，任何包含 `..`、绝对路径、盘符、
 * 控制字符的条目都直接拒绝整包，而不是「跳过继续解」。
 *
 * @module dsh-plugin-fish-pet/lib/live2d-package
 */

import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

/** 上传 zip 的压缩体积上限：48MB（手机端模型包通常 <20MB）。 */
export const MAX_ZIP_BYTES = 48 * 1024 * 1024

/** 解压后的总体积上限：96MB，防 zip 炸弹。 */
export const MAX_TOTAL_UNCOMPRESSED = 96 * 1024 * 1024

/** 单个文件解压后的体积上限：32MB（moc3/贴图级别）。 */
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024

/** zip 条目数量上限。 */
export const MAX_ENTRIES = 3000

/** 模型最多保留的文件数（去掉垃圾文件后）。 */
export const MAX_MODEL_FILES = 2000

/** 相对路径最长字符与最深层级。 */
const MAX_PATH_LENGTH = 240
const MAX_PATH_DEPTH = 10

/** zip 魔数。 */
const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

/**
 * 带错误码的模型包错误。
 *
 * 前端/路由层直接把 code 与 message 返回给用户，message 是中文人话。
 */
export class Live2DError extends Error {
  /**
   * @param {string} code - 稳定错误码（大写蛇形）。
   * @param {string} message - 面向用户的中文说明。
   */
  constructor(code, message) {
    super(message)
    this.name = 'Live2DError'
    this.code = code
  }
}

/**
 * 把字节数格式化成可读文本（错误提示用）。
 * @param {number} n
 * @returns {string}
 */
function formatBytes(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '0 B'
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 解码 zip 条目名。
 *
 * 约定：通用标志位 bit 11 置位表示 UTF-8；否则先按 UTF-8 解，出现替换符再按 GBK 解。
 * 很多中文环境压缩工具不置 UTF-8 位却写 GBK，这一步能避免文件名变成乱码。
 *
 * @param {Buffer} buf
 * @param {number} flags
 * @returns {string}
 */
function decodeEntryName(buf, flags) {
  const isUtf8 = (flags & 0x800) !== 0
  if (isUtf8) return buf.toString('utf8')
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return utf8
  }
}

/**
 * 在缓冲区里定位 EOCD（中央目录结束记录）。
 *
 * 从尾部向前找签名，并用注释长度校验，避免把注释里的假签名当成 EOCD。
 *
 * @param {Buffer} buf
 * @returns {number} EOCD 起始偏移。
 */
function findEndOfCentralDirectory(buf) {
  const minEocd = 22
  if (buf.length < minEocd) throw new Live2DError('BAD_ARCHIVE', '这不是一个有效的 zip 文件')
  const start = Math.max(0, buf.length - minEocd - 0xffff)
  for (let i = buf.length - minEocd; i >= start; i--) {
    if (buf.readUInt32LE(i) !== SIG_EOCD) continue
    const commentLength = buf.readUInt16LE(i + 20)
    if (i + minEocd + commentLength === buf.length) return i
  }
  throw new Live2DError('BAD_ARCHIVE', '这不是一个有效的 zip 文件（找不到中央目录）')
}

/**
 * 读取 zip 中央目录条目（不解压）。
 *
 * 不支持 ZIP64 / 分卷 / 加密：真实模型包不会用到，遇到时给出明确错误。
 *
 * @param {Buffer} buf
 * @returns {Array<{
 *   name: string, flags: number, method: number,
 *   compressedSize: number, uncompressedSize: number, localOffset: number
 * }>}
 */
export function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf)) throw new Live2DError('BAD_ARCHIVE', '上传内容不是二进制数据')
  if (buf.length > MAX_ZIP_BYTES) {
    throw new Live2DError('TOO_LARGE', `压缩包太大（${formatBytes(buf.length)}），上限 ${formatBytes(MAX_ZIP_BYTES)}`)
  }
  const eocd = findEndOfCentralDirectory(buf)
  const diskNumber = buf.readUInt16LE(eocd + 4)
  const centralDisk = buf.readUInt16LE(eocd + 6)
  const countOnDisk = buf.readUInt16LE(eocd + 8)
  const count = buf.readUInt16LE(eocd + 10)
  const centralSize = buf.readUInt32LE(eocd + 12)
  const centralOffset = buf.readUInt32LE(eocd + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || countOnDisk !== count) {
    throw new Live2DError('BAD_ARCHIVE', '不支持分卷压缩包，请重新压缩成一个 zip')
  }
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Live2DError('BAD_ARCHIVE', '不支持 ZIP64 格式，请用普通 zip 重新压缩')
  }
  if (count > MAX_ENTRIES) {
    throw new Live2DError('TOO_MANY_FILES', `压缩包内文件太多（${count} 个），上限 ${MAX_ENTRIES} 个`)
  }
  if (centralOffset + centralSize > buf.length) {
    throw new Live2DError('BAD_ARCHIVE', 'zip 中央目录越界，文件可能已损坏')
  }

  const entries = []
  let offset = centralOffset
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Live2DError('BAD_ARCHIVE', 'zip 中央目录损坏')
    }
    const flags = buf.readUInt16LE(offset + 8)
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const uncompressedSize = buf.readUInt32LE(offset + 24)
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    if (offset + 46 + nameLength + extraLength + commentLength > buf.length) {
      throw new Live2DError('BAD_ARCHIVE', 'zip 中央目录条目越界')
    }
    if ((flags & 0x1) !== 0) {
      throw new Live2DError('BAD_ARCHIVE', '不支持加密压缩包，请去掉密码后重新压缩')
    }
    if (method !== 0 && method !== 8) {
      throw new Live2DError('BAD_ARCHIVE', `不支持的压缩方式（method=${method}），请用标准 zip 重新压缩`)
    }
    const rawName = buf.subarray(offset + 46, offset + 46 + nameLength)
    entries.push({
      name: decodeEntryName(Buffer.from(rawName), flags),
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * 是否是应当忽略的系统垃圾条目。
 * @param {string} name
 * @returns {boolean}
 */
function isJunkEntry(name) {
  if (name.endsWith('/')) return true
  if (name.startsWith('__MACOSX/')) return true
  const base = name.slice(name.lastIndexOf('/') + 1)
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini') return true
  if (base.startsWith('._')) return true
  return false
}

/**
 * 规范化并校验 zip 条目路径（相对路径，正斜杠）。
 *
 * 拒绝：绝对路径、盘符、`..`、空段、控制字符、超长路径。
 *
 * @param {string} raw - zip 里的原始条目名。
 * @returns {string} 安全相对路径。
 * @throws {Live2DError} 路径非法时。
 */
export function sanitizeZipPath(raw) {
  const source = String(raw ?? '')
    .replace(/\\/g, '/')
  if (source.includes('\u0000')) {
    throw new Live2DError('BAD_PATH', `压缩包内路径包含空字符：${source.slice(0, 80)}`)
  }
  if (/[\u0000-\u001f\u007f]/.test(source)) {
    throw new Live2DError('BAD_PATH', `压缩包内路径包含控制字符：${source.slice(0, 80)}`)
  }
  if (source.startsWith('/') || /^[A-Za-z]:/.test(source)) {
    throw new Live2DError('BAD_PATH', `压缩包内出现绝对路径：${source.slice(0, 80)}`)
  }
  const segments = source.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.some(segment => segment === '..')) {
    throw new Live2DError('BAD_PATH', `压缩包内出现越界路径：${source.slice(0, 80)}`)
  }
  if (segments.length === 0) {
    throw new Live2DError('BAD_PATH', '压缩包内出现空路径')
  }
  if (segments.length > MAX_PATH_DEPTH) {
    throw new Live2DError('BAD_PATH', `压缩包内目录层级过深：${source.slice(0, 80)}`)
  }
  const normalized = segments.join('/')
  if (normalized.length > MAX_PATH_LENGTH) {
    throw new Live2DError('BAD_PATH', `压缩包内路径过长：${source.slice(0, 80)}`)
  }
  if (segments.some(segment => segment.length > 120)) {
    throw new Live2DError('BAD_PATH', `压缩包内文件名过长：${source.slice(0, 80)}`)
  }
  return normalized
}

/**
 * 读取条目对应的本地文件头，返回数据区起点。
 * @param {Buffer} buf
 * @param {{ localOffset: number }} entry
 * @returns {number} 数据起始偏移。
 */
function localDataOffset(buf, entry) {
  const at = entry.localOffset
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== SIG_LOCAL) {
    throw new Live2DError('BAD_ARCHIVE', 'zip 本地文件头损坏')
  }
  const nameLength = buf.readUInt16LE(at + 26)
  const extraLength = buf.readUInt16LE(at + 28)
  const start = at + 30 + nameLength + extraLength
  if (start + entry.compressedSize > buf.length) {
    throw new Live2DError('BAD_ARCHIVE', 'zip 数据区越界，文件可能已损坏')
  }
  return start
}

/**
 * 解出 zip 内的普通文件（过滤垃圾、校验路径、控制体积）。
 *
 * 返回顺序与压缩包内顺序一致；重复路径会报错，避免同名文件互相覆盖。
 *
 * @param {Buffer} buf - 整个 zip。
 * @returns {Array<{ path: string, size: number, data: Buffer }>}
 */
export function extractZipFiles(buf) {
  const entries = readZipEntries(buf)
  /** @type {Map<string, true>} */
  const seen = new Set()
  const files = []
  let total = 0
  for (const entry of entries) {
    if (isJunkEntry(entry.name)) continue
    const path = sanitizeZipPath(entry.name)
    if (seen.has(path)) {
      throw new Live2DError('DUPLICATE_FILE', `压缩包内有重复文件：${path}`)
    }
    seen.add(path)
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Live2DError('TOO_LARGE', `压缩包内文件过大：${path}（${formatBytes(entry.uncompressedSize)}）`)
    }
    total += entry.uncompressedSize
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new Live2DError('TOO_LARGE', `解压后体积超过上限 ${formatBytes(MAX_TOTAL_UNCOMPRESSED)}，已拒绝`)
    }
    if (files.length >= MAX_MODEL_FILES) {
      throw new Live2DError('TOO_MANY_FILES', `模型文件数超过上限 ${MAX_MODEL_FILES}`)
    }
    const start = localDataOffset(buf, entry)
    const compressed = buf.subarray(start, start + entry.compressedSize)
    let data
    if (entry.method === 0) {
      data = Buffer.from(compressed)
    } else {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 })
      } catch (error) {
        throw new Live2DError('BAD_ARCHIVE', `解压失败：${path}（${error?.message ?? error}）`)
      }
    }
    if (data.length !== entry.uncompressedSize) {
      throw new Live2DError('BAD_ARCHIVE', `解压后大小不符：${path}`)
    }
    files.push({ path, size: data.length, data })
  }
  if (files.length === 0) {
    throw new Live2DError('EMPTY_ARCHIVE', '压缩包是空的，或者里面没有模型文件')
  }
  return files
}

/**
 * 在文件列表里按相对路径找文件，先精确匹配，再大小写不敏感兜底。
 *
 * 为什么兜底：Windows 打的包偶尔与 model3.json 里的大小写不一致，
 * 直接照路径读会 404，用户只会看到「模型加载失败」，很难排查。
 *
 * @param {Array<{ path: string, data: Buffer }>} files
 * @param {string} path
 * @returns {{ path: string, data: Buffer } | undefined}
 */
export function findFile(files, path) {
  const normalized = String(path ?? '').replace(/\\/g, '/')
  const exact = files.find(file => file.path === normalized)
  if (exact) return exact
  const lower = normalized.toLowerCase()
  return files.find(file => file.path.toLowerCase() === lower)
}

/** 相对路径的目录部分（没有目录时返回空串）。 */
function dirname(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** 把 model3.json 里的相对引用解析成包内路径。 */
function resolveReference(modelDir, ref) {
  const parts = String(ref ?? '').replace(/\\/g, '/').split('/').filter(part => part !== '' && part !== '.')
  const base = modelDir === '' ? [] : modelDir.split('/')
  for (const part of parts) {
    if (part === '..') {
      if (base.length === 0) {
        throw new Live2DError('BAD_REFERENCE', `模型引用了包外路径：${ref}`)
      }
      base.pop()
    } else {
      base.push(part)
    }
  }
  return base.join('/')
}

/**
 * 在文件列表里定位 Cubism 模型，解析 model3.json 并校验必需文件。
 *
 * 只支持 Cubism 3/4（.model3.json + .moc3）。Cubism 2 的 .model.json 会明确拒绝，
 * 而不是让前端加载到一半才报错。
 *
 * @param {Array<{ path: string, data: Buffer }>} files
 * @returns {{
 *   modelJsonPath: string,
 *   modelDir: string,
 *   version: '4',
 *   settings: object,
 *   motions: Array<{ name: string, count: number }>,
 *   expressionNames: string[],
 *   hasPhysics: boolean,
 *   hasPose: boolean,
 *   textureCount: number,
 * }}
 */
export function locateCubismModel(files) {
  const modelCandidates = files.filter(file => /\.model3\.json$/i.test(file.path))
  const legacyCandidates = files.filter(file => /\.model\.json$/i.test(file.path))
  if (modelCandidates.length === 0) {
    if (legacyCandidates.length > 0) {
      throw new Live2DError(
        'CUBISM2_UNSUPPORTED',
        '这是 Cubism 2 模型（.model.json），当前只支持 Cubism 3/4（.model3.json + .moc3）',
      )
    }
    throw new Live2DError(
      'NO_MODEL_FILE',
      '压缩包里没有找到 model3.json，请确认上传的是 Cubism 3/4 模型文件夹（内含 model3.json、moc3 与贴图）',
    )
  }

  // 多个模型时优先选层级最浅、路径最短的那个；真实模型包通常只有一个
  modelCandidates.sort((a, b) => {
    const depthA = a.path.split('/').length
    const depthB = b.path.split('/').length
    if (depthA !== depthB) return depthA - depthB
    return a.path.length - b.path.length
  })
  const modelJson = modelCandidates[0]
  let settings
  try {
    settings = JSON.parse(modelJson.data.toString('utf8'))
  } catch (error) {
    throw new Live2DError('BAD_MODEL_JSON', `model3.json 不是合法 JSON：${error?.message ?? error}`)
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Live2DError('BAD_MODEL_JSON', 'model3.json 内容不是一个对象')
  }
  const refs = settings.FileReferences
  if (refs === null || typeof refs !== 'object' || Array.isArray(refs)) {
    throw new Live2DError('BAD_MODEL_JSON', 'model3.json 缺少 FileReferences')
  }
  if (typeof refs.Moc !== 'string' || refs.Moc.trim() === '') {
    throw new Live2DError('BAD_MODEL_JSON', 'model3.json 的 FileReferences.Moc 缺失')
  }
  const modelDir = dirname(modelJson.path)
  const mocPath = resolveReference(modelDir, refs.Moc)
  if (!findFile(files, mocPath)) {
    throw new Live2DError('MODEL_INCOMPLETE', `模型缺少 moc3 文件：${mocPath}`)
  }

  const textures = Array.isArray(refs.Textures) ? refs.Textures : []
  if (textures.length === 0) {
    throw new Live2DError('MODEL_INCOMPLETE', 'model3.json 没有声明任何贴图（FileReferences.Textures 为空）')
  }
  for (const texture of textures) {
    if (typeof texture !== 'string') {
      throw new Live2DError('BAD_MODEL_JSON', 'model3.json 的贴图列表包含非字符串项')
    }
    const texturePath = resolveReference(modelDir, texture)
    if (!findFile(files, texturePath)) {
      throw new Live2DError('MODEL_INCOMPLETE', `模型缺少贴图文件：${texturePath}`)
    }
  }

  // 动作组：Cubism 3/4 规范放在 FileReferences.Motions；少数工具会写在根上，两个都认
  const motions = []
  const motionConf = (refs.Motions && typeof refs.Motions === 'object')
    ? refs.Motions
    : settings.Motions
  if (motionConf && typeof motionConf === 'object' && !Array.isArray(motionConf)) {
    for (const [name, list] of Object.entries(motionConf)) {
      if (!Array.isArray(list) || list.length === 0) continue
      const valid = list.filter(item => item && typeof item === 'object' && item.File)
      if (valid.length === 0) continue
      motions.push({ name: String(name).slice(0, 40), count: valid.length })
    }
  }

  // 表情同样优先取 FileReferences.Expressions
  const expressionNames = []
  const expressionConf = Array.isArray(refs.Expressions)
    ? refs.Expressions
    : (Array.isArray(settings.Expressions) ? settings.Expressions : [])
  for (const expression of expressionConf) {
    if (!expression || typeof expression !== 'object') continue
    const name = typeof expression.Name === 'string' && expression.Name.trim() !== ''
      ? expression.Name.trim()
      : ''
    if (name) expressionNames.push(name.slice(0, 48))
  }

  // 点击区域（Head / Body 等）：Cubism 4 的 model3.json 根上有 HitAreas
  const hitAreas = []
  if (Array.isArray(settings.HitAreas)) {
    for (const area of settings.HitAreas) {
      if (!area || typeof area !== 'object') continue
      if (typeof area.Name === 'string' && area.Name.trim() !== '') {
        hitAreas.push(area.Name.trim().slice(0, 40))
      }
    }
  }

  return {
    modelJsonPath: modelJson.path,
    modelDir,
    version: '4',
    settings,
    motions,
    expressionNames,
    hitAreas,
    hasPhysics: typeof refs.Physics === 'string' && refs.Physics.trim() !== '',
    hasPose: typeof refs.Pose === 'string' && refs.Pose.trim() !== '',
    textureCount: textures.length,
  }
}

/**
 * 清洗模型显示名：去控制字符、压缩空白、限长。
 * @param {unknown} raw
 * @param {string} [fallback]
 * @returns {string}
 */
export function sanitizeModelName(raw, fallback = 'Live2D 模型') {
  const name = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48)
    : ''
  return name || fallback
}

/**
 * 根据模型内容生成稳定 id。
 *
 * 同一份模型重复上传会得到同一个 id（幂等覆盖）；名称参与哈希，
 * 这样用户给同一个模型改个备注名，也能当成新的条目。
 *
 * @param {string} name
 * @param {Array<{ path: string, data: Buffer }>} files
 * @returns {string}
 */
export function createModelId(name, files) {
  const hash = createHash('sha1')
  hash.update(String(name))
  hash.update('\0')
  for (const file of files) {
    hash.update(file.path)
    hash.update('\0')
    const digest = createHash('sha1').update(file.data).digest('hex')
    hash.update(digest)
  }
  return `l2d-${hash.digest('hex').slice(0, 12)}`
}

/**
 * 把「用户上传的 zip」变成可以直接落盘的模型包。
 *
 * @param {Buffer} zipBuffer
 * @param {{ name?: string, fallbackName?: string }} [options]
 * @returns {{
 *   id: string,
 *   name: string,
 *   files: Array<{ path: string, data: Buffer }>,
 *   meta: object,
 * }}
 */
export function prepareModelPackage(zipBuffer, options = {}) {
  const files = extractZipFiles(zipBuffer)
  const model = locateCubismModel(files)
  const name = sanitizeModelName(
    options.name,
    sanitizeModelName(options.fallbackName, 'Live2D 模型'),
  )
  const id = createModelId(name, files)
  const totalBytes = files.reduce((sum, file) => sum + file.data.length, 0)
  const meta = {
    id,
    name,
    version: model.version,
    modelJsonPath: model.modelJsonPath,
    modelDir: model.modelDir,
    motions: model.motions,
    expressions: model.expressionNames,
    hitAreas: model.hitAreas,
    hasPhysics: model.hasPhysics,
    hasPose: model.hasPose,
    textureCount: model.textureCount,
    fileCount: files.length,
    size: totalBytes,
  }
  return { id, name, files, meta }
}
