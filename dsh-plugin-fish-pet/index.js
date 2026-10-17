/**
 * 桌宠插件（宿主侧）。
 *
 * 职责：
 *  - `/api/fish-pet/balance`  余额 + 峰谷时段 + 消耗速率
 *  - `/api/fish-pet/image`    内置桌宠图
 *  - `/api/fish-pet/weather`  实时天气（Open-Meteo，无需密钥）
 *  - `/api/fish-pet/settings` 读写用户设置
 *  - `/api/fish-pet/custom-image` 上传/读取自定义外观（png/jpg/gif/webp）
 *  - `/api/fish-pet/sound`    上传/读取点击音效
 *
 * 为什么用 HTTP 路由而不是 index-inject：
 * index-inject 的 value 会被 JSON 序列化，函数会被丢弃（实测得到空对象 `{}`），
 * 因此不能承载「刷新」这类行为，只能传纯数据；而余额需要按需刷新，
 * 走 webServer.register 是唯一正确的通道。
 *
 * 安全约定与余额插件一致：API Key 只从环境变量读取，绝不出现在响应体和日志里。
 *
 * @module dsh-plugin-fish-pet
 */

import z from '@deepseek-ai/schemastery'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fetchBalance, resolveApiKey } from 'dsh-plugin-deepseek-balance/balance'
import {
  resolvePhase,
  describePhase,
  untilNextChange,
  phaseLabel,
  formatDuration,
} from 'dsh-plugin-deepseek-balance/peak'
import {
  normalizeSettings,
  projectWeather,
  SETTINGS_DEFAULTS,
} from './lib/pet-settings.js'

export const name = 'fish-pet'

/** 前端拉取余额的路径（与 client.js 保持一致）。 */
export const BALANCE_PATH = '/api/fish-pet/balance'

/** 桌宠原图端点（与 client.js 的 PET_IMG 保持一致）。 */
export const PET_IMG_PATH = '/api/fish-pet/image'

/** 天气端点。 */
export const WEATHER_PATH = '/api/fish-pet/weather'

/** 用户设置端点。 */
export const SETTINGS_PATH = '/api/fish-pet/settings'

/** 自定义外观端点。 */
export const CUSTOM_IMAGE_PATH = '/api/fish-pet/custom-image'

/** 点击音效端点。 */
export const SOUND_PATH = '/api/fish-pet/sound'

/** 桌宠图片文件（相对本模块，透明背景 PNG）。 */
const PET_IMAGE_FILE = new URL('./pet.png', import.meta.url)

/** 允许的自定义外观 MIME 与扩展名。 */
const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

/** 允许的音效 MIME 与扩展名。 */
const SOUND_TYPES = {
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
}

/** 上传体积上限：图片 8MB，音效 2MB。 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_SOUND_BYTES = 2 * 1024 * 1024

/**
 * 内置常见城市坐标（GCJ 无偏移的 WGS84 近似值）。
 *
 * 用途：受限网络下 geocoding 端点可能不可达，本地表可让天气继续工作。
 * 不在表里的城市仍会走在线地理编码。
 */
export const KNOWN_CITIES = {
  北京: { lat: 39.9075, lon: 116.3972, name: '北京' },
  上海: { lat: 31.2304, lon: 121.4737, name: '上海' },
  广州: { lat: 23.1291, lon: 113.2644, name: '广州' },
  深圳: { lat: 22.5431, lon: 114.0579, name: '深圳' },
  杭州: { lat: 30.2741, lon: 120.1551, name: '杭州' },
  南京: { lat: 32.0603, lon: 118.7969, name: '南京' },
  成都: { lat: 30.5728, lon: 104.0668, name: '成都' },
  重庆: { lat: 29.5630, lon: 106.5516, name: '重庆' },
  武汉: { lat: 30.5928, lon: 114.3055, name: '武汉' },
  西安: { lat: 34.3416, lon: 108.9398, name: '西安' },
  天津: { lat: 39.3434, lon: 117.3616, name: '天津' },
  苏州: { lat: 31.2989, lon: 120.5853, name: '苏州' },
  长沙: { lat: 28.2282, lon: 112.9388, name: '长沙' },
  郑州: { lat: 34.7466, lon: 113.6254, name: '郑州' },
  青岛: { lat: 36.0671, lon: 120.3826, name: '青岛' },
  沈阳: { lat: 41.8057, lon: 123.4315, name: '沈阳' },
  厦门: { lat: 24.4798, lon: 118.0894, name: '厦门' },
  昆明: { lat: 25.0389, lon: 102.7183, name: '昆明' },
  合肥: { lat: 31.8206, lon: 117.2272, name: '合肥' },
  福州: { lat: 26.0745, lon: 119.2965, name: '福州' },
  哈尔滨: { lat: 45.8038, lon: 126.5350, name: '哈尔滨' },
  济南: { lat: 36.6512, lon: 117.1201, name: '济南' },
  大连: { lat: 38.9140, lon: 121.6147, name: '大连' },
  宁波: { lat: 29.8683, lon: 121.5440, name: '宁波' },
  无锡: { lat: 31.4912, lon: 120.3119, name: '无锡' },
  佛山: { lat: 23.0219, lon: 113.1214, name: '佛山' },
  东莞: { lat: 23.0207, lon: 113.7518, name: '东莞' },
  珠海: { lat: 22.2707, lon: 113.5767, name: '珠海' },
  南昌: { lat: 28.6820, lon: 115.8579, name: '南昌' },
  贵阳: { lat: 26.6470, lon: 106.6302, name: '贵阳' },
  石家庄: { lat: 38.0428, lon: 114.5149, name: '石家庄' },
  太原: { lat: 37.8706, lon: 112.5489, name: '太原' },
  兰州: { lat: 36.0611, lon: 103.8343, name: '兰州' },
  乌鲁木齐: { lat: 43.8256, lon: 87.6168, name: '乌鲁木齐' },
  拉萨: { lat: 29.6520, lon: 91.1721, name: '拉萨' },
  海口: { lat: 20.0444, lon: 110.1999, name: '海口' },
  南宁: { lat: 22.8170, lon: 108.3665, name: '南宁' },
  呼和浩特: { lat: 40.8424, lon: 111.7490, name: '呼和浩特' },
  银川: { lat: 38.4872, lon: 106.2309, name: '银川' },
  西宁: { lat: 36.6171, lon: 101.7782, name: '西宁' },
  香港: { lat: 22.3193, lon: 114.1694, name: '香港' },
  澳门: { lat: 22.1987, lon: 113.5439, name: '澳门' },
  台北: { lat: 25.0330, lon: 121.5654, name: '台北' },
  东京: { lat: 35.6762, lon: 139.6503, name: '东京' },
  首尔: { lat: 37.5665, lon: 126.9780, name: '首尔' },
  新加坡: { lat: 1.3521, lon: 103.8198, name: '新加坡' },
  纽约: { lat: 40.7128, lon: -74.0060, name: '纽约' },
  伦敦: { lat: 51.5074, lon: -0.1278, name: '伦敦' },
  巴黎: { lat: 48.8566, lon: 2.3522, name: '巴黎' },
}

/** 所需服务：HTTP 路由注册。 */
export const inject = ['webServer']

/** 插件配置。 */
export const Config = z.object({
  /** 余额缓存有效期（毫秒）；前端轮询更频繁时命中缓存。 */
  cacheTtlMs: z.number().min(5000).max(3600000).default(60000),
  /** 失败结果的缓存期（毫秒），比成功短，避免错误态粘住。 */
  errorTtlMs: z.number().min(1000).max(600000).default(10000),
  /** 余额历史采样点数上限：用于估算消耗速率，只在内存里滚动。 */
  historyCapacity: z.number().min(2).max(1000).default(60),
  /** 单次查询超时。 */
  timeoutMs: z.number().min(1000).max(60000).default(15000),
  /** 官方余额端点。 */
  endpoint: z.string().default('https://api.deepseek.com/user/balance'),
  /** 设置与自定义素材的存放目录；默认在插件目录下的 .data。 */
  dataDir: z.string().default(''),
  /** 天气缓存有效期（毫秒）。 */
  weatherTtlMs: z.number().min(60000).max(3600000).default(600000),
})
/**
 * 创建带 TTL 的余额读取器。
 *
 * 并发调用会合并到同一个 in-flight Promise，避免前端连刷时打出多份上游请求。
 *
 * @param {{ endpoint: string, timeoutMs: number, cacheTtlMs: number, errorTtlMs: number }} config
 * @param {() => number} [now] - 可注入时钟，便于测试。
 * @returns {() => Promise<object>} 读取函数，返回 fetchBalance 的原始结果。
 */
export function createBalanceReader(config, now = Date.now) {
  let cached = null
  let cachedAt = 0
  let inflight = null

  return async function read() {
    const at = now()
    if (cached) {
      const ttl = cached.ok ? config.cacheTtlMs : (config.errorTtlMs ?? 10000)
      if (at - cachedAt < ttl) return cached
    }
    if (inflight) return inflight

    inflight = (async () => {
      try {
        const { key: apiKey } = resolveApiKey()
        const result = await fetchBalance({
          apiKey: apiKey ?? undefined,
          endpoint: config.endpoint,
          timeoutMs: config.timeoutMs,
        })
        cached = result
        cachedAt = now()
        return result
      } finally {
        inflight = null
      }
    })()

    return inflight
  }
}

/**
 * 余额变化历史追踪器。
 *
 * 目的：回答「余额还剩多少」之外的问题——「按现在的速度还能用多久」。
 * 只保留最近 N 个采样点，在内存里滚动，不落盘、不上传。
 *
 * @param {{ capacity?: number }} [options]
 * @returns {{ push: (total: number, atMs: number) => void, rate: (currency: string) => object }}
 */
export function createBalanceHistory(options = {}) {
  const capacity = options.capacity ?? 60
  /** @type {Array<{ total: number, atMs: number }>} */
  let samples = []

  return {
    /** 记录一个采样点；同一时刻重复写入会覆盖。 */
    push(total, atMs) {
      if (!Number.isFinite(total) || !Number.isFinite(atMs)) return
      const last = samples[samples.length - 1]
      if (last && last.atMs === atMs) {
        last.total = total
        return
      }
      samples.push({ total, atMs })
      if (samples.length > capacity) samples.shift()
    },

    /**
     * 估算消耗速率与剩余可用时长。
     *
     * 只在「余额确实下降过」时给出结论；上涨（充值）或数据不足时返回 null，
     * 不编造一个数字。
     *
     * @param {string} currency - 币种，仅用于标签。
     * @returns {{
     *   perHour: number | null,
     *   hoursLeft: number | null,
     *   sampleCount: number,
     *   trend: 'down' | 'up' | 'flat' | 'insufficient',
     *   currency: string,
     * }}
     */
    rate(currency = '') {
      if (samples.length < 2) {
        return { perHour: null, hoursLeft: null, sampleCount: samples.length, trend: 'insufficient', currency }
      }
      const first = samples[0]
      const last = samples[samples.length - 1]
      const elapsedMs = last.atMs - first.atMs
      // 时间跨度太短会算出荒谬的速率
      if (elapsedMs < 60 * 1000) {
        return { perHour: null, hoursLeft: null, sampleCount: samples.length, trend: 'insufficient', currency }
      }
      const delta = last.total - first.total
      const hours = elapsedMs / 3600000
      if (Math.abs(delta) < 0.0001) {
        return { perHour: 0, hoursLeft: null, sampleCount: samples.length, trend: 'flat', currency }
      }
      if (delta > 0) {
        return { perHour: null, hoursLeft: null, sampleCount: samples.length, trend: 'up', currency }
      }
      const perHour = -delta / hours
      const hoursLeft = perHour > 0 ? last.total / perHour : null
      return { perHour, hoursLeft, sampleCount: samples.length, trend: 'down', currency }
    },
  }
}

/**
 * 把查询结果压成前端投影。绝不包含任何密钥字段。
 * @param {object} result - fetchBalance 的结果。
 * @returns {object} 前端可用的纯数据。
 */
export function projectForClient(result, rate = null) {
  if (!result || result.ok !== true) {
    return {
      ok: false,
      code: result?.code ?? 'UNKNOWN',
      message: result?.message ?? '余额暂不可用',
      fetchedAt: new Date().toISOString(),
    }
  }
  const primary = Array.isArray(result.balances) && result.balances.length > 0
    ? result.balances[0]
    : null
  // 峰谷时段：与余额工具保持一致，桌宠也要能看到当前计价时段
  const phase = resolvePhase()
  const next = untilNextChange()
  return {
    ok: true,
    isAvailable: result.isAvailable,
    currency: primary?.currency ?? '',
    total: primary?.total ?? '0',
    granted: primary?.granted ?? '0',
    toppedUp: primary?.toppedUp ?? '0',
    fetchedAt: result.checkedAt ?? new Date().toISOString(),
    phase: phase.phase,
    phaseLabel: phaseLabel(phase.phase),
    phaseReason: phase.reason,
    phaseSummary: describePhase(),
    nextPhase: next.nextPhase,
    nextPhaseLabel: phaseLabel(next.nextPhase),
    nextChangeMs: next.nextChangeMs,
    nextChangeText: next.nextChangeMs > 0 ? formatDuration(next.nextChangeMs) : '',
    calendarCovered: phase.calendarCovered,
    // 消耗速率（采样不足、余额上涨或持平时为 null，前端据此不展示估算）
    burnRate: rate,
  }
}


/**
 * 简单 JSON 文件存储（无外部依赖）。
 *
 * 为什么不用 DSH 的 settings 服务：那是绑定插件 Config 的表单系统，
 * 面向「运维配置」；这里的偏好与素材属于用户数据，独立文件更合适，
 * 也不会污染 cordis.patch.yml。
 *
 * @param {URL} file - 目标文件。
 * @param {object} fallback - 文件不存在时的默认值。
 */
export function createJsonStore(file, fallback) {
  let cache = null
  return {
    /** 读取（带内存缓存）。 */
    async read() {
      if (cache) return cache
      try {
        const raw = await readFile(file, 'utf8')
        cache = { ...fallback, ...JSON.parse(raw) }
      } catch {
        cache = { ...fallback }
      }
      return cache
    },
    /** 整体覆盖写入。 */
    async write(value) {
      cache = { ...fallback, ...value }
      await mkdir(new URL('.', file), { recursive: true })
      await writeFile(file, JSON.stringify(cache, null, 2), { mode: 0o600 })
      return cache
    },
  }
}

/**
 * 读取请求体（带上限）。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * 猜 MIME：优先用请求头，其次按文件头魔数校验，防止伪装扩展名。
 *
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function sniffImageType(buf) {
  if (buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (buf.length >= 6 && buf.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF'
    && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

/**
 * 带重试的 fetch。
 *
 * 为什么需要：部分网络环境下同一主机名偶发 ETIMEDOUT（实测 geocoding 端点会超时，
 * 但 curl 正常），单次失败就让天气整块不可用太脆。这里对「网络层错误」重试，
 * 对 4xx 直接返回不重试（那是确定性的失败）。
 *
 * @param {string} url
 * @param {{ attempts?: number, timeoutMs?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}) {
  const attempts = options.attempts ?? 2
  const timeoutMs = options.timeoutMs ?? 20000
  let lastError = null
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status >= 400 && res.status < 500) return res
      return res
    } catch (error) {
      lastError = error
      // 仅对网络层错误重试
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastError ?? new Error('fetch failed')
}

/**
 * 判断音效类型：按魔数识别 mp3/wav/ogg/webm。
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function sniffSoundType(buf) {
  if (buf.length >= 3 && buf.slice(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg'
  // MP3 帧同步：0xFF 0xE0 掩码
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF'
    && buf.slice(8, 12).toString('ascii') === 'WAVE') return 'audio/wav'
  if (buf.length >= 4 && buf.slice(0, 4).toString('ascii') === 'OggS') return 'audio/ogg'
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm'
  return null
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply(ctx, config) {
  const read = createBalanceReader(config)
  // 余额历史只在内存中滚动，用于估算「还能用多久」，不落盘
  const history = createBalanceHistory({ capacity: config.historyCapacity ?? 60 })

  /** 数据目录：默认插件目录下 .data（已被 .gitignore 忽略）。 */
  const dataDir = new URL(
    config.dataDir ? `file://${config.dataDir.replace(/\/+$/, '')}/` : './.data/',
    import.meta.url,
  )
  const settingsFile = new URL('settings.json', dataDir)
  const customImageFile = new URL('custom-image', dataDir)
  const customImageMeta = new URL('custom-image.json', dataDir)
  const soundFile = new URL('sound', dataDir)
  const soundMeta = new URL('sound.json', dataDir)

  const store = createJsonStore(settingsFile, SETTINGS_DEFAULTS)

  /** 天气缓存（内存）。 */
  const weatherCache = { payload: null, at: 0 }
  /** 地理编码缓存：城市名 -> 坐标，避免反复查。 */
  const geoCache = new Map()

  /** 统一的 JSON 响应。 */
  const json = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  // ---- 余额 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BALANCE_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' })
        res.end('{"ok":false,"code":"METHOD_NOT_ALLOWED"}')
        return
      }
      let payload
      try {
        const result = await read()
        let rate = null
        if (result?.ok === true) {
          const primary = Array.isArray(result.balances) && result.balances.length > 0
            ? result.balances[0]
            : null
          const total = Number.parseFloat(primary?.total ?? '')
          if (Number.isFinite(total)) {
            history.push(total, Date.now())
            rate = history.rate(primary?.currency ?? '')
          }
        }
        payload = projectForClient(result, rate)
      } catch (error) {
        payload = {
          ok: false,
          code: 'CLIENT_ERROR',
          message: String(error?.message ?? error),
          fetchedAt: new Date().toISOString(),
        }
      }
      json(res, 200, payload)
    },
  }), 'fish-pet: balance route')

  // ---- 内置图片 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PET_IMG_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      try {
        const png = await readFile(PET_IMAGE_FILE)
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(png.length),
          'cache-control': 'public, max-age=86400',
        })
        res.end(png)
      } catch (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`pet image unavailable: ${error?.code ?? 'UNKNOWN'}`)
      }
    },
  }), 'fish-pet: image route')

  // ---- 天气 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WEATHER_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      const settings = await store.read()
      if (!settings.weatherEnabled) {
        json(res, 200, { ok: false, code: 'DISABLED', message: '天气已关闭' })
        return
      }
      const now = Date.now()
      if (weatherCache.payload && now - weatherCache.at < (config.weatherTtlMs ?? 600000)) {
        json(res, 200, { ...weatherCache.payload, cached: true })
        return
      }
      try {
        const city = settings.weatherCity
        let geo = geoCache.get(city)
        if (!geo) {
          // 先查内置坐标表：受限网络下地理编码端点可能不可达，
          // 常见城市直接命中本地表可避免整个天气功能失效。
          const local = KNOWN_CITIES[city]
          if (local) {
            geo = local
            geoCache.set(city, geo)
          }
        }
        if (!geo) {
          const geoRes = await fetchWithRetry(
            `https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=${encodeURIComponent(city)}`,
          )
          if (!geoRes.ok) throw new Error(`geocoding HTTP ${geoRes.status}`)
          const geoJson = await geoRes.json()
          const first = Array.isArray(geoJson?.results) ? geoJson.results[0] : null
          if (!first) {
            json(res, 200, { ok: false, code: 'CITY_NOT_FOUND', message: `找不到城市：${city}` })
            return
          }
          geo = { lat: first.latitude, lon: first.longitude, name: first.name }
          geoCache.set(city, geo)
        }
        const wxRes = await fetchWithRetry(
          'https://api.open-meteo.com/v1/forecast'
          + `?latitude=${geo.lat}&longitude=${geo.lon}`
          + '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto',
        )
        if (!wxRes.ok) throw new Error(`weather HTTP ${wxRes.status}`)
        const payload = projectWeather(await wxRes.json())
        const withCity = { ...payload, city: geo.name }
        weatherCache.payload = withCity
        weatherCache.at = now
        json(res, 200, withCity)
      } catch (error) {
        json(res, 200, {
          ok: false,
          code: 'WEATHER_UNAVAILABLE',
          message: `天气获取失败：${error?.message ?? error}`,
        })
      }
    },
  }), 'fish-pet: weather route')

  // ---- 设置读写 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SETTINGS_PATH,
    async handler(req, res) {
      if (req.method === 'GET') {
        json(res, 200, { ok: true, settings: normalizeSettings(await store.read()) })
        return
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        try {
          const body = await readBody(req, 256 * 1024)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          const next = normalizeSettings(parsed)
          await store.write(next)
          json(res, 200, { ok: true, settings: next })
        } catch (error) {
          json(res, 400, {
            ok: false,
            code: error?.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'BAD_REQUEST',
            message: String(error?.message ?? error),
          })
        }
        return
      }
      res.writeHead(405, { allow: 'GET, PUT' })
      res.end()
    },
  }), 'fish-pet: settings route')

  // ---- 自定义外观 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CUSTOM_IMAGE_PATH,
    async handler(req, res) {
      if (req.method === 'GET') {
        try {
          const meta = JSON.parse(await readFile(customImageMeta, 'utf8'))
          const buf = await readFile(customImageFile)
          res.writeHead(200, {
            'content-type': meta.type,
            'content-length': String(buf.length),
            'cache-control': 'public, max-age=86400',
          })
          res.end(buf)
        } catch {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          res.end('{"ok":false,"code":"NO_CUSTOM_IMAGE"}')
        }
        return
      }
      if (req.method === 'POST') {
        try {
          const buf = await readBody(req, MAX_IMAGE_BYTES)
          const type = sniffImageType(buf)
          if (!type || !IMAGE_TYPES[type]) {
            json(res, 400, {
              ok: false,
              code: 'UNSUPPORTED_TYPE',
              message: '只支持 PNG / JPG / GIF / WebP',
            })
            return
          }
          await mkdir(dataDir, { recursive: true })
          await writeFile(customImageFile, buf, { mode: 0o600 })
          await writeFile(customImageMeta, JSON.stringify({ type, size: buf.length }), { mode: 0o600 })
          const version = createHash('sha1').update(buf).digest('hex').slice(0, 10)
          json(res, 200, {
            ok: true,
            type,
            size: buf.length,
            url: `${CUSTOM_IMAGE_PATH}?v=${version}`,
          })
        } catch (error) {
          json(res, error?.code === 'TOO_LARGE' ? 413 : 400, {
            ok: false,
            code: error?.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'UPLOAD_FAILED',
            message: error?.code === 'TOO_LARGE' ? '文件超过 8MB' : String(error?.message ?? error),
          })
        }
        return
      }
      res.writeHead(405, { allow: 'GET, POST' })
      res.end()
    },
  }), 'fish-pet: custom image route')

  // ---- 音效 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SOUND_PATH,
    async handler(req, res) {
      if (req.method === 'GET') {
        try {
          const meta = JSON.parse(await readFile(soundMeta, 'utf8'))
          const buf = await readFile(soundFile)
          res.writeHead(200, {
            'content-type': meta.type,
            'content-length': String(buf.length),
            'cache-control': 'public, max-age=86400',
          })
          res.end(buf)
        } catch {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          res.end('{"ok":false,"code":"NO_SOUND"}')
        }
        return
      }
      if (req.method === 'POST') {
        try {
          const buf = await readBody(req, MAX_SOUND_BYTES)
          const type = sniffSoundType(buf)
          if (!type || !SOUND_TYPES[type]) {
            json(res, 400, {
              ok: false,
              code: 'UNSUPPORTED_TYPE',
              message: '只支持 MP3 / WAV / OGG / WebM',
            })
            return
          }
          await mkdir(dataDir, { recursive: true })
          await writeFile(soundFile, buf, { mode: 0o600 })
          await writeFile(soundMeta, JSON.stringify({ type, size: buf.length }), { mode: 0o600 })
          const version = createHash('sha1').update(buf).digest('hex').slice(0, 10)
          json(res, 200, { ok: true, type, size: buf.length, url: `${SOUND_PATH}?v=${version}` })
        } catch (error) {
          json(res, error?.code === 'TOO_LARGE' ? 413 : 400, {
            ok: false,
            code: error?.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'UPLOAD_FAILED',
            message: error?.code === 'TOO_LARGE' ? '文件超过 2MB' : String(error?.message ?? error),
          })
        }
        return
      }
      res.writeHead(405, { allow: 'GET, POST' })
      res.end()
    },
  }), 'fish-pet: sound route')

  ctx.logger?.('fish-pet').info(
    '桌宠端点已就绪：%s, %s, %s, %s, %s, %s',
    BALANCE_PATH, PET_IMG_PATH, WEATHER_PATH, SETTINGS_PATH, CUSTOM_IMAGE_PATH, SOUND_PATH,
  )
}
