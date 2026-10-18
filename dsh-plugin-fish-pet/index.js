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
import { readFile, writeFile, mkdir, stat, rm, readdir, rename, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
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
import {
  CATALOG,
  normalizeVoiceSource,
  normalizeVoiceSources,
  maskVoiceSource,
  sourceReadiness,
  buildSynthesisRequest,
  searchCatalog,
  sourceFromCatalog,
  SPEECH_LANGS,
  checkLanguageSupport,
  searchVoiceLibrary,
  sourceFromVoiceLibrary,
  VOICE_LIBRARY,
  MAX_TEXT_LENGTH,
} from './lib/voice-sources.js'
import { cacheKey, createThrottle, createAudioIndex, sniffAudio, describeUpstreamFailure } from './lib/tts-cache.js'
import {
  autoSourceName,
  formatElapsed,
  isHarvestDue,
  localDayKey,
  pickAutoSources,
  summarizeReport,
} from './lib/harvest.js'
import {
  Live2DError,
  MAX_ZIP_BYTES as MAX_LIVE2D_ZIP_BYTES,
  prepareModelPackage,
  sanitizeZipPath,
} from './lib/live2d-package.js'
import {
  ANIMATION_BASE_PATH,
  ANIMATION_EXT,
  ANIMATION_MATTE_BASE_PATH,
  ANIMATION_MATTE_SUBDIR,
  ANIMATION_SUBDIR,
  ANIMATIONS_PATH,
  buildAnimationManifest,
  normalizeClipName,
} from './lib/anim-catalog.js'
import { LIVE2D_MODEL_ID_PATTERN } from './lib/pet-settings.js'

export const name = 'fish-pet'

/** 前端拉取余额的路径（与 client.js 保持一致）。 */
export const BALANCE_PATH = '/api/fish-pet/balance'

/** 桌宠原图端点（与 client.js 的 PET_IMG 保持一致）。 */
export const PET_IMG_PATH = '/api/fish-pet/image'

/**
 * 内置占位桌宠（简单小鱼 SVG，自绘，无第三方素材版权问题）。
 *
 * 发行版不附带任何图片文件；用户可用菜单里的「自定义图片」换成自己的图，
 * 或把喜欢的图片放成插件目录下的 pet.png 覆盖它。
 */
export const PLACEHOLDER_PET_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 171 240" width="171" height="240">',
  '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#8fd3f4"/><stop offset="1" stop-color="#4a90d9"/>',
  '</linearGradient></defs>',
  '<ellipse cx="85" cy="120" rx="62" ry="72" fill="url(#g)"/>',
  '<path d="M23 120 L-2 84 L-2 156 Z" fill="#6cb6e8"/>',
  '<circle cx="62" cy="96" r="9" fill="#ffffff"/><circle cx="64" cy="96" r="4.5" fill="#1f2d3d"/>',
  '<circle cx="110" cy="96" r="9" fill="#ffffff"/><circle cx="112" cy="96" r="4.5" fill="#1f2d3d"/>',
  '<path d="M66 140 Q85 156 104 140" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round"/>',
  '<circle cx="42" cy="132" r="8" fill="#ffb3c1" opacity="0.75"/>',
  '<circle cx="128" cy="132" r="8" fill="#ffb3c1" opacity="0.75"/>',
  '</svg>',
].join('')

/** 天气端点。 */
export const WEATHER_PATH = '/api/fish-pet/weather'

/** 用户设置端点。 */
export const SETTINGS_PATH = '/api/fish-pet/settings'

/** 自定义外观端点。 */
export const CUSTOM_IMAGE_PATH = '/api/fish-pet/custom-image'

/** 点击音效端点。 */
export const SOUND_PATH = '/api/fish-pet/sound'

/** 当前音效状态（只读）：内置合成音还是上传的文件。 */
export const SOUND_STATUS_PATH = '/api/fish-pet/sound-status'

/** 声源管理端点。 */
export const VOICES_PATH = '/api/fish-pet/voices'

/** 社区声源目录（可搜索）。 */
export const VOICE_CATALOG_PATH = '/api/fish-pet/voices/catalog'

/** 合成语音。 */
export const SPEAK_PATH = '/api/fish-pet/speak'

/** 合成结果音频。 */
export const SPEAK_AUDIO_PATH = '/api/fish-pet/speak-audio'

/** 上传参考音视频、建立克隆声源。 */
export const CLONE_PATH = '/api/fish-pet/voice-clone'

/** 前端错误上报（手机上看不到控制台，靠它收集）。 */
export const CLIENT_ERROR_PATH = '/api/fish-pet/client-error'

/** 每日声源校准：状态 / 立即运行 / 确认通知 / 换基准。 */
export const HARVEST_PATH = '/api/fish-pet/harvest'

/** 校准候选音频试听。 */
export const HARVEST_AUDIO_PATH = '/api/fish-pet/harvest/audio'

/** 总开关（一键关闭肥鱼）：客户端把开关同步到宿主，宿主管住后台任务。 */
export const POWER_PATH = '/api/fish-pet/power'

/**
 * 桌宠动画形象（上游 dsh-pet 的透明 webm 素材）。
 *
 * 素材文件本身不入库（用户放在 .data/animations/webm），这里只提供清单与静态文件路由。
 */
export { ANIMATIONS_PATH, ANIMATION_BASE_PATH, ANIMATION_MATTE_BASE_PATH }

/** 校准状态文件默认值。 */
export const HARVEST_STATE_DEFAULTS = {
  /** 最近一次成功运行的本地日期键（YYYY-MM-DD）。 */
  lastRunDay: '',
  /** 最近一次运行的开始时间戳。 */
  lastRunAt: 0,
  /** 最近一次运行的报告摘要（不存全部候选，避免状态文件膨胀）。 */
  lastReport: null,
  /** 最近一次失败的错误信息。 */
  lastError: null,
  /** 待展示的通知；客户端确认后置空。 */
  notification: null,
  /** 用户指定的基准（从某个视频抽出来的参考音频）。 */
  anchor: null,
  /** 已经处理过的 bvid，避免每天重复抓同一批视频。 */
  seenBvids: [],
}

/** Live2D 模型列表 / 上传 / 删除。 */
export const LIVE2D_MODELS_PATH = '/api/fish-pet/live2d/models'

/**
 * Live2D 模型静态文件前缀：`<前缀>/<模型 id>/<包内相对路径>`。
 *
 * 为什么用路径而不是查询串：model3.json 内部用相对路径引用 moc3/贴图，
 * 浏览器与 pixi 都会基于「model3.json 的 URL」解析这些相对路径。
 * 若 model3.json 的 URL 形如 /file?id=x&p=model.model3.json，
 * 相对路径会解析成 /api/fish-pet/live2d/Haru.moc3 这类错误地址。
 * 路径式 URL 让相对解析天然正确。
 */
export const LIVE2D_MODEL_BASE = '/api/fish-pet/live2d/model'

/** Live2D 运行时（PixiJS / Cubism Core / pixi-live2d-display），前缀路由。 */
export const LIVE2D_RUNTIME_PATH = '/api/fish-pet/live2d/runtime'

/** 随插件分发的 Live2D 运行时文件（白名单，不开放任意目录）。 */
const LIVE2D_RUNTIME_FILES = {
  'pixi.min.js': 'text/javascript; charset=utf-8',
  'live2dcubismcore.min.js': 'text/javascript; charset=utf-8',
  'cubism4.min.js': 'text/javascript; charset=utf-8',
}
const LIVE2D_RUNTIME_DIR = new URL('./assets/live2d/', import.meta.url)

/** Live2D 模型文件的 MIME 映射；未知扩展名回退二进制。 */
const LIVE2D_FILE_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.moc3': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
}

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
  /**
   * 数据目录。留空则用插件自带的 .data。
   *
   * 也可以由环境变量 DSH_FISH_PET_DATA 指定——沙箱/并行验证时用它指向
   * 独立目录，避免和生产实例抢同一份声源数据。
   */
  dataDir: z.string().default(process.env.DSH_FISH_PET_DATA || ''),
  /** 天气缓存有效期（毫秒）。 */
  weatherTtlMs: z.number().min(60000).max(3600000).default(600000),
  /** 两次 TTS 上游请求的最小间隔（毫秒）；百度实测 2s 稳定。 */
  ttsMinIntervalMs: z.number().min(0).max(10000).default(2000),
  /** TTS 单次请求超时（毫秒）。 */
  ttsTimeoutMs: z.number().min(1000).max(60000).default(20000),
  /** 本地克隆模型目录（含 zipvoice 目录与 vocos_24khz.onnx）。 */
  cloneModelDir: z.string().default(''),
  /** Python 解释器路径。 */
  pythonBin: z.string().default('python3'),
  /** 克隆合成超时（毫秒）。 */
  cloneTimeoutMs: z.number().min(5000).max(300000).default(120000),
  /**
   * 桌宠动画素材目录（放上游 dsh-pet 的透明 webm）。
   *
   * 留空 = `<dataDir>/animations/webm`（插件 .data 下，已加入 .gitignore，不进仓库）。
   * 也可以由环境变量 DSH_FISH_PET_ANIM_DIR 指定，便于把 53MB 素材放到别的盘。
   */
  animationDir: z.string().default(process.env.DSH_FISH_PET_ANIM_DIR || ''),
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
  const method = options.method ?? 'GET'
  const headers = options.headers ?? { accept: 'application/json' }
  const body = options.body
  let lastError = null
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      // 4xx 是确定性失败，不重试
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
/**
 * 解析克隆模型目录：优先配置，其次默认位置。
 * 默认位置：$DSH_HOME/fish-pet/models 或 ~/.dsh/fish-pet/models。
 * @param {object} config
 * @returns {string | null} 存在的目录，找不到返回 null。
 */
export function resolveCloneModelDir(config) {
  const candidates = []
  if (config.cloneModelDir) candidates.push(config.cloneModelDir)
  const home = homedir()
  candidates.push(join(home, '.dsh', 'fish-pet', 'models'))
  if (process.env.DSH_HOME) candidates.push(join(process.env.DSH_HOME, 'fish-pet', 'models'))
  for (const dir of candidates) {
    try {
      if (existsSync(dir)) return dir
    } catch { /* ignore */ }
  }
  return null
}

/**
 * 运行 Python 助手并解析它输出的最后一行 JSON。
 *
 * 助手约定：成功与业务失败都以 JSON 打到 stdout；崩溃才走 stderr。
 *
 * @param {object} config
 * @param {string[]} args
 * @param {number} [timeoutMs] - 超时；默认用 cloneTimeoutMs（普通克隆足够）。
 * @returns {Promise<object>} 解析后的结果；失败返回 { ok:false, code, message }。
 */
export function runPython(config, args, timeoutMs) {
  return new Promise(resolve => {
    const bin = config.pythonBin || 'python3'
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = value => {
      if (settled) return
      settled = true
      resolve(value)
    }

    let child
    try {
      child = spawn(bin, args, { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, code: 'NO_PYTHON', message: `无法启动 Python（${bin}）：${error.message}` })
      return
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      done({ ok: false, code: 'TIMEOUT', message: '本地语音处理超时' })
    }, Number.isFinite(timeoutMs) ? timeoutMs : (config.cloneTimeoutMs ?? 120000))

    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', error => {
      clearTimeout(timer)
      done({
        ok: false,
        code: error.code === 'ENOENT' ? 'NO_PYTHON' : 'SPAWN_FAILED',
        message: error.code === 'ENOENT'
          ? `找不到 Python 解释器（${bin}），请在配置里指定 pythonBin`
          : String(error.message ?? error),
      })
    })
    child.on('close', () => {
      clearTimeout(timer)
      // 取最后一行合法 JSON（助手可能打印第三方库的日志）
      const lines = stdout.trim().split('\n').filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i])
          if (parsed && typeof parsed === 'object' && 'ok' in parsed) { done(parsed); return }
        } catch { /* 继续往前找 */ }
      }
      const tail = stderr.trim().split('\n').slice(-3).join(' | ')
      done({
        ok: false,
        code: 'PYTHON_FAILED',
        message: tail ? `本地语音处理失败：${tail}` : '本地语音处理失败（无输出）',
      })
    })
  })
}

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
  const clientErrorFile = new URL('client-errors.jsonl', dataDir)
  const customImageFile = new URL('custom-image', dataDir)
  const customImageMeta = new URL('custom-image.json', dataDir)
  const soundFile = new URL('sound', dataDir)
  const soundMeta = new URL('sound.json', dataDir)

  const store = createJsonStore(settingsFile, SETTINGS_DEFAULTS)

  // ---- 语音（TTS）----
  // 声源列表同样是用户数据，单独存一个文件，避免和设置互相覆盖
  const voicesFile = new URL('voices.json', dataDir)
  const voicesStore = createJsonStore(voicesFile, { sources: [], currentId: '' })
  const ttsDir = new URL('tts/', dataDir)
  const cloneDir = new URL('clone/', dataDir)
  // 每日声源校准：候选音频与状态都放独立目录，方便整体清理
  const harvestDir = new URL('harvest/', dataDir)
  const harvestStore = createJsonStore(new URL('state.json', harvestDir), HARVEST_STATE_DEFAULTS)
  // Live2D 模型：<dataDir>/live2d/<id>/model/... + <id>/meta.json
  const live2dDir = new URL('live2d/', dataDir)
  // 桌宠动画素材：<dataDir>/animations/webm/<动画名>.webm（素材不入库，用户本机放置）
  const animationDir = config.animationDir
    ? new URL(`file://${config.animationDir.replace(/\/+$/, '')}/`)
    : new URL(`${ANIMATION_SUBDIR}/`, dataDir)
  // 白底版本（alpha 不可用时的回退）：默认与 webm/ 同级
  const animationMatteDir = config.animationDir
    ? new URL('../webm-matte/', animationDir)
    : new URL(`${ANIMATION_MATTE_SUBDIR}/`, dataDir)
  const audioIndex = createAudioIndex({ capacity: 300 })
  const throttle = createThrottle({ minIntervalMs: config.ttsMinIntervalMs ?? 2000 })

  /** 读取声源列表（含内置默认声源兜底）。 */
  const loadVoices = async () => {
    const doc = await voicesStore.read()
    const sources = normalizeVoiceSources(doc.sources)
    const currentId = typeof doc.currentId === 'string' ? doc.currentId.slice(0, 48) : ''
    return { sources, currentId }
  }

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

  // ---- Live2D 模型存储辅助 ----

  /**
   * 读取单个模型的元数据。
   * @param {string} id - 模型 id（调用方已校验形状）。
   * @returns {Promise<object|null>}
   */
  const readLive2DMeta = async id => {
    try {
      const raw = await readFile(new URL(`${id}/meta.json`, live2dDir), 'utf8')
      const meta = JSON.parse(raw)
      if (!meta || typeof meta !== 'object' || meta.id !== id) return null
      if (!Array.isArray(meta.motions)) meta.motions = []
      if (!Array.isArray(meta.expressions)) meta.expressions = []
      return meta
    } catch {
      return null
    }
  }

  /**
   * 列出所有可用 Live2D 模型（按上传时间倒序）。
   * @returns {Promise<Array<object>>}
   */
  const listLive2DModels = async () => {
    let entries = []
    try {
      entries = await readdir(live2dDir, { withFileTypes: true })
    } catch {
      return []
    }
    const models = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!LIVE2D_MODEL_ID_PATTERN.test(entry.name)) continue
      const meta = await readLive2DMeta(entry.name)
      if (!meta) continue
      // 模型文件可能被手动删掉：列出来也加载不了，直接过滤
      try {
        await stat(new URL(`${entry.name}/model/${meta.modelJsonPath}`, live2dDir))
      } catch {
        continue
      }
      models.push({
        id: meta.id,
        name: typeof meta.name === 'string' ? meta.name : 'Live2D 模型',
        version: meta.version === '2' ? '2' : '4',
        size: Number.isFinite(meta.size) ? meta.size : 0,
        fileCount: Number.isFinite(meta.fileCount) ? meta.fileCount : 0,
        motions: Array.isArray(meta.motions) ? meta.motions : [],
        expressions: Array.isArray(meta.expressions) ? meta.expressions : [],
        textureCount: Number.isFinite(meta.textureCount) ? meta.textureCount : 0,
        // 前端要用它拼 model3.json 的路径式 URL，缺了会导致模型加载 404
        modelJsonPath: typeof meta.modelJsonPath === 'string' ? meta.modelJsonPath : '',
        uploadedAt: typeof meta.uploadedAt === 'string' ? meta.uploadedAt : '',
      })
    }
    models.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
    return models
  }

  /**
   * 把「模型 id + 包内相对路径」解析成受控的绝对路径。
   *
   * 双重校验：id 只允许固定形状；相对路径走 sanitizeZipPath（拒绝 ..、绝对路径），
   * 最后再用 resolve 后前缀比对兜底，杜绝任何形式的目录穿越。
   *
   * @param {string} id
   * @param {string} relative
   * @returns {string} 绝对文件路径。
   * @throws {Live2DError}
   */
  const resolveLive2DFilePath = (id, relative) => {
    if (!LIVE2D_MODEL_ID_PATTERN.test(id)) {
      throw new Live2DError('BAD_MODEL_ID', '模型 id 不合法')
    }
    const safeRelative = sanitizeZipPath(relative)
    const root = fileURLToPath(new URL(`${id}/model/`, live2dDir))
    const target = resolvePath(root, safeRelative)
    if (target !== root && !target.startsWith(root.endsWith(sep) ? root : root + sep)) {
      throw new Live2DError('BAD_PATH', '模型文件路径越界')
    }
    return target
  }

  /**
   * 按扩展名取 MIME。
   * @param {string} path
   * @returns {string}
   */
  const live2dMime = path => {
    const index = path.lastIndexOf('.')
    const ext = index < 0 ? '' : path.slice(index).toLowerCase()
    return LIVE2D_FILE_TYPES[ext] ?? 'application/octet-stream'
  }

  /** 读取并返回一个模型静态文件；失败时给出 JSON 404。 */
  const serveLive2DFile = async (res, id, relative) => {
    let target
    try {
      target = resolveLive2DFilePath(id, relative)
    } catch (error) {
      json(res, 400, {
        ok: false,
        code: error?.code ?? 'BAD_PATH',
        message: String(error?.message ?? error),
      })
      return
    }
    try {
      const info = await stat(target)
      if (!info.isFile()) throw new Error('not a file')
      const buf = await readFile(target)
      res.writeHead(200, {
        'content-type': live2dMime(target),
        'content-length': String(buf.length),
        // 模型 id 由内容哈希生成：同一 id 的字节不会变，可以放心缓存
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      })
      res.end(buf)
    } catch {
      json(res, 404, { ok: false, code: 'NOT_FOUND', message: '模型文件不存在' })
    }
  }

  // ---- 桌宠动画素材（上游 dsh-pet 的透明 webm）----

  /**
   * 动画目录扫描缓存。
   *
   * 素材是用户手工放进目录的，频率很低；5 秒 TTL 能让「放进去 → 刷新页面」
   * 立刻生效，又不会每次清单请求都 readdir 一遍。
   */
  const animationScan = { at: 0, names: [], error: '' }
  const animationMatteScan = { at: 0, names: [], error: '' }

  /**
   * 扫描一个动画目录，返回可播放的动画名（不含扩展名）。
   * @param {URL} dir
   * @param {{ at: number, names: string[], error: string }} cache
   * @param {boolean} [force] - 忽略缓存重扫。
   * @returns {Promise<string[]>}
   */
  const scanClipDir = async (dir, cache, force = false) => {
    const now = Date.now()
    if (!force && cache.names.length > 0 && now - cache.at < 5000) {
      return cache.names
    }
    let entries = []
    let error = ''
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (e) {
      // ENOENT = 还没放素材，是预期状态，不当错误
      error = e?.code === 'ENOENT' ? '' : String(e?.message ?? e)
      entries = []
    }
    const names = []
    for (const entry of entries) {
      // 只认普通文件：符号链接可能指到目录外，一律不跟
      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      if (!lower.endsWith(ANIMATION_EXT)) continue
      const name = normalizeClipName(entry.name.slice(0, -ANIMATION_EXT.length))
      if (!name) continue
      names.push(name)
    }
    cache.at = now
    cache.names = names
    cache.error = error
    return names
  }

  /** 扫描透明动画目录。 */
  const scanAnimationClips = force => scanClipDir(animationDir, animationScan, force)
  /** 扫描白底动画目录。 */
  const scanAnimationMatteClips = force => scanClipDir(animationMatteDir, animationMatteScan, force)

  /**
   * 读一个动画文件；名字必须先在扫描结果里，避免任何路径拼接风险。
   * @param {string} name - 已规范化的动画名。
   * @param {boolean} [matte] - 读白底版本。
   * @returns {Promise<Buffer|null>}
   */
  const readAnimationClip = async (name, matte = false) => {
    const names = matte ? await scanAnimationMatteClips() : await scanAnimationClips()
    if (!names.includes(name)) return null
    const dir = matte ? animationMatteDir : animationDir
    try {
      return await readFile(new URL(`${name}${ANIMATION_EXT}`, dir))
    } catch {
      return null
    }
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
      } catch {
        // 没有 pet.png 时给一个内置占位图，保证开箱就能看到桌宠。
        // 开源发行版不带图片资源，用户可用「自定义图片」换成自己的。
        const svg = Buffer.from(PLACEHOLDER_PET_SVG, 'utf8')
        res.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'content-length': String(svg.length),
          'cache-control': 'public, max-age=3600',
        })
        res.end(svg)
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
          // 合并更新：先取当前值再覆盖传入字段。
          // 若直接 normalize(parsed)，只传一个字段会把其余设置重置成默认值。
          const current = await store.read()
          const merged = { ...current }
          for (const [k, v] of Object.entries(parsed)) {
            if (v !== undefined) merged[k] = v
          }
          const next = normalizeSettings(merged)
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
          await writeFile(soundMeta, JSON.stringify({
            type,
            size: buf.length,
            uploadedAt: new Date().toISOString(),
          }), { mode: 0o600 })
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
      if (req.method === 'DELETE') {
        // 清除自定义音效，回到内置合成音
        try {
          await rm(soundFile, { force: true })
          await rm(soundMeta, { force: true })
        } catch { /* 本来就没有，忽略 */ }
        json(res, 200, { ok: true, removed: true })
        return
      }
      res.writeHead(405, { allow: 'GET, POST, DELETE' })
      res.end()
    },
  }), 'fish-pet: sound route')

  // ---- 音效状态（只读）：告诉前端当前用的是内置合成音还是上传的文件 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SOUND_STATUS_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      let uploaded = null
      try {
        const meta = JSON.parse(await readFile(soundMeta, 'utf8'))
        const buf = await readFile(soundFile)
        const version = createHash('sha1').update(buf).digest('hex').slice(0, 10)
        uploaded = {
          type: meta.type,
          size: buf.length,
          uploadedAt: typeof meta.uploadedAt === 'string' ? meta.uploadedAt : null,
          url: `${SOUND_PATH}?v=${version}`,
        }
      } catch { /* 没有上传过 */ }
      json(res, 200, {
        ok: true,
        // 有上传文件就是 custom，否则是内置合成音 builtin
        source: uploaded ? 'custom' : 'builtin',
        uploaded,
      })
    },
  }), 'fish-pet: sound status route')

  // ---- 社区声源目录（可搜索）----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: VOICE_CATALOG_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
      const url = new URL(req.url ?? '', 'http://localhost')
      const q = url.searchParams.get('q') ?? ''
      const voices = searchVoiceLibrary(q).map(v => ({
        id: v.id,
        name: v.name,
        provider: v.provider,
        voice: v.voice,
        tags: v.tags,
      }))
      const items = searchCatalog(q).map(entry => ({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        tags: entry.tags,
        languages: entry.languages,
        needsKey: entry.needsKey,
        description: entry.description,
        homepage: entry.homepage ?? '',
      }))
      json(res, 200, {
        ok: true,
        total: CATALOG.length,
        matched: items.length,
        items,
        voices,
        voiceTotal: VOICE_LIBRARY.length,
        voiceMatched: voices.length,
        query: q,
      })
    },
  }), 'fish-pet: voice catalog route')

  // ---- 声源管理：列表 / 新增 / 更新 / 删除 / 设为当前 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: VOICES_PATH,
    async handler(req, res) {
      if (req.method === 'GET') {
        const { sources, currentId } = await loadVoices()
        json(res, 200, {
          ok: true,
          currentId,
          // 密钥一律只回传 hasKey，不回传明文
          sources: sources.map(maskVoiceSource),
          readiness: Object.fromEntries(sources.map(s => [s.id, sourceReadiness(s)])),
        })
        return
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        try {
          const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
          const doc = await voicesStore.read()
          let sources = normalizeVoiceSources(doc.sources)
          let currentId = typeof doc.currentId === 'string' ? doc.currentId : ''

          // 从社区目录添加
          if (body.action === 'addFromCatalog') {
            const catalogId = String(body.catalogId ?? '')
            // voice: 前缀表示「音色库里的某个音色」
            const created = catalogId.startsWith('voice:')
              ? sourceFromVoiceLibrary(catalogId)
              : sourceFromCatalog(catalogId)
            if (!created) { json(res, 400, { ok: false, code: 'UNKNOWN_CATALOG', message: '目录里没有这一项' }); return }
            sources = normalizeVoiceSources([...sources, created])
            currentId = currentId || created.id
            await voicesStore.write({ sources, currentId })
            json(res, 200, { ok: true, added: maskVoiceSource(created), sources: sources.map(maskVoiceSource), currentId })
            return
          }

          // 新增或更新
          if (body.action === 'save') {
            const incoming = body.source
            // 更新时若未提交 apiKey，保留旧密钥
            let merged = incoming
            if (incoming && incoming.id) {
              const old = sources.find(s => s.id === incoming.id)
              if (old && old.apiKey && !incoming.apiKey) merged = { ...incoming, apiKey: old.apiKey }
            }
            const src = normalizeVoiceSource(merged)
            if (!src) { json(res, 400, { ok: false, code: 'BAD_SOURCE', message: '声源配置不合法' }); return }
            const idx = sources.findIndex(s => s.id === src.id)
            if (idx >= 0) sources[idx] = src
            else sources = normalizeVoiceSources([...sources, src])
            currentId = currentId || src.id
            await voicesStore.write({ sources, currentId })
            json(res, 200, { ok: true, sources: sources.map(maskVoiceSource), currentId })
            return
          }

          // 删除
          if (body.action === 'delete') {
            const id = String(body.id ?? '')
            sources = sources.filter(s => s.id !== id)
            if (currentId === id) currentId = sources[0]?.id ?? ''
            await voicesStore.write({ sources, currentId })
            json(res, 200, { ok: true, sources: sources.map(maskVoiceSource), currentId })
            return
          }

          // 设为当前
          if (body.action === 'select') {
            const id = String(body.id ?? '')
            if (!sources.some(s => s.id === id)) {
              json(res, 400, { ok: false, code: 'NOT_FOUND', message: '声源不存在' })
              return
            }
            currentId = id
            await voicesStore.write({ sources, currentId })
            json(res, 200, { ok: true, currentId, sources: sources.map(maskVoiceSource) })
            return
          }

          json(res, 400, { ok: false, code: 'BAD_ACTION', message: '未知操作' })
        } catch (error) {
          json(res, 400, {
            ok: false,
            code: error?.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'BAD_REQUEST',
            message: String(error?.message ?? error),
          })
        }
        return
      }

      res.writeHead(405, { allow: 'GET, POST, PUT' })
      res.end()
    },
  }), 'fish-pet: voices route')

  // ---- 合成语音 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SPEAK_PATH,
    async handler(req, res) {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
      let payload
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
        const text = String(body.text ?? '').trim()
        // 语种：auto 或不传表示跟随声源
        const rawLang = String(body.lang ?? 'auto')
        const lang = SPEECH_LANGS.includes(rawLang) ? rawLang : 'auto'
        if (!text) { json(res, 400, { ok: false, code: 'EMPTY_TEXT', message: '文本为空' }); return }
        if (text.length > MAX_TEXT_LENGTH) {
          json(res, 400, { ok: false, code: 'TEXT_TOO_LONG', message: `文本超过 ${MAX_TEXT_LENGTH} 字` })
          return
        }

        const settings = await store.read()
        if (settings.voiceEnabled === false) {
          json(res, 200, { ok: false, code: 'DISABLED', message: '语音已关闭' })
          return
        }

        // 选声源：显式指定 > 当前声源 > 内置默认
        const { sources, currentId } = await loadVoices()
        let source = null
        if (body.sourceId) source = sources.find(s => s.id === String(body.sourceId)) ?? null
        if (!source && currentId) source = sources.find(s => s.id === currentId) ?? null
        if (!source) source = sourceFromCatalog('baidu-free')

        const ready = sourceReadiness(source)
        if (!ready.ok) {
          json(res, 200, { ok: false, code: 'SOURCE_NOT_READY', message: `声源不可用：${ready.reason}` })
          return
        }

        // 只有真正受语种影响的声源才按语种分缓存；
        // 克隆/本地音频忽略语种，否则会重复存多份完全相同的音频
        const langAffectsAudio = source.type !== 'zipvoice' && source.type !== 'local'
        const key = cacheKey(source, text, langAffectsAudio ? lang : 'auto')
        const cachedName = audioIndex.get(key)

        // 命中内存索引：直接返回已有文件
        if (cachedName) {
          json(res, 200, { ok: true, url: `${SPEAK_AUDIO_PATH}?h=${key}`, cached: true, sourceId: source.id, sourceName: source.name })
          return
        }

        // 命中磁盘（重启后第一次）：直接用
        try {
          const st = await stat(new URL(`${key}.audio`, ttsDir))
          if (st.isFile() && st.size > 0) {
            audioIndex.set(key, `${key}.audio`)
            json(res, 200, { ok: true, url: `${SPEAK_AUDIO_PATH}?h=${key}`, cached: true, sourceId: source.id, sourceName: source.name })
            return
          }
        } catch { /* 没有磁盘缓存，继续合成 */ }

        // 语种不被当前声源支持时直接说明，不要发出必然失败的请求
        const langCheck = checkLanguageSupport(source.type, lang)
        if (!langCheck.ok) {
          json(res, 200, {
            ok: false,
            code: 'LANG_UNSUPPORTED',
            message: `${source.name || '当前声源'} 不支持该语种，可改用`
              + `「手机自带语音」或 Azure。`,
          })
          return
        }

        const spec = buildSynthesisRequest(source, text, { lang })

        // 本地克隆：调用 Python 助手（ZipVoice 零样本）
        if (spec.expect === 'clone') {
          // 复用外层已算好的 key（含语种），不要在这里重新算，否则语种不生效
          const cached = audioIndex.get(key)
          if (cached) {
            json(res, 200, { ok: true, url: `${SPEAK_AUDIO_PATH}?h=${key}`, cached: true, sourceId: source.id, sourceName: source.name })
            return
          }
          try {
            const st = await stat(new URL(`${key}.wav`, ttsDir))
            if (st.isFile() && st.size > 0) {
              audioIndex.set(key, `${key}.wav`)
              json(res, 200, { ok: true, url: `${SPEAK_AUDIO_PATH}?h=${key}`, cached: true, sourceId: source.id, sourceName: source.name })
              return
            }
          } catch { /* 继续合成 */ }

          const modelDir = resolveCloneModelDir(config)
          if (!modelDir) {
            json(res, 200, { ok: false, code: 'NO_MODEL_DIR', message: '未找到克隆模型目录' })
            return
          }
          await mkdir(ttsDir, { recursive: true })
          const scriptPath = fileURLToPath(new URL('./scripts/clone_tts.py', import.meta.url))
          const refPath = fileURLToPath(new URL(`clone/${source.refWav}`, dataDir))
          const outPath = fileURLToPath(new URL(`${key}.wav`, ttsDir))
          const run = await runPython(config, [
            scriptPath, 'synthesize',
            '--text', text,
            '--ref-wav', refPath,
            '--ref-text', source.refText,
            '--out-wav', outPath,
            '--model-dir', modelDir,
            '--vocoder', join(modelDir, 'vocos_24khz.onnx'),
          ])
          if (!run.ok) {
            json(res, 200, { ok: false, code: run.code, message: run.message })
            return
          }
          audioIndex.set(key, `${key}.wav`)
          json(res, 200, {
            ok: true,
            url: `${SPEAK_AUDIO_PATH}?h=${key}`,
            cached: false,
            bytes: run.bytes,
            duration: run.duration,
            sourceId: source.id,
            sourceName: source.name,
          })
          return
        }

        // 本地合成（手机自带语音）：不在宿主合成，交给前端 speechSynthesis
        if (spec.expect === 'client') {
          json(res, 200, {
            ok: true,
            clientSide: true,
            text,
            voiceName: spec.client.voiceName,
            rate: spec.client.rate,
            pitch: spec.client.pitch,
            lang: spec.client.lang ?? '',
            sourceId: source.id,
            sourceName: source.name,
          })
          return
        }

        const synthOnce = async () => {
          const upstream = await fetchWithRetry(spec.url, {
            method: spec.method,
            headers: spec.headers,
            body: spec.body ?? undefined,
            attempts: 2,
            timeoutMs: config.ttsTimeoutMs ?? 20000,
          })
          if (!upstream.ok) {
            let buf = Buffer.alloc(0)
            try { buf = Buffer.from(await upstream.arrayBuffer()) } catch { /* ignore */ }
            return { ok: false, message: describeUpstreamFailure(upstream.status, buf) }
          }
          let audio = Buffer.from(await upstream.arrayBuffer())
          // 有些服务（火山）在 200 里回 JSON，音频是 base64 放在 data 字段
          if (spec.expect === 'json-base64') {
            let parsed = null
            try { parsed = JSON.parse(audio.toString('utf8')) } catch { /* 继续按音频处理 */ }
            if (parsed) {
              if (parsed.code && parsed.code !== 3000) {
                return { ok: false, message: `语音服务返回错误码 ${parsed.code}：${parsed.message ?? ''}` }
              }
              if (typeof parsed.data === 'string' && parsed.data.length > 0) {
                audio = Buffer.from(parsed.data, 'base64')
              }
            }
          }
          const sniff = sniffAudio(audio)
          if (!sniff.ok) {
            const text = audio.toString('utf8')
            // 百度会以 200 + JSON 的形式报限流，这类错误值得等一下重试
            if (/ratelimit|err_no.*50[0-9]|Not verified/i.test(text)) {
              return { ok: false, retryable: true, message: describeUpstreamFailure(200, audio) }
            }
            return { ok: false, message: describeUpstreamFailure(200, audio) }
          }
          await mkdir(ttsDir, { recursive: true })
          const fileName = `${key}.audio`
          await writeFile(new URL(fileName, ttsDir), audio, { mode: 0o600 })
          audioIndex.set(key, fileName)
          return { ok: true, size: audio.length, mime: sniff.mime }
        }

        // 限流时退避重试（最多 3 次），其余错误立即返回
        let result = null
        for (let attempt = 0; attempt < 3; attempt++) {
          result = await throttle.run(key, synthOnce)
          if (result.ok || !result.retryable) break
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        }

        if (!result.ok) {
          json(res, 200, { ok: false, code: 'SYNTHESIS_FAILED', message: result.message })
          return
        }

        payload = {
          ok: true,
          url: `${SPEAK_AUDIO_PATH}?h=${key}`,
          cached: false,
          bytes: result.size,
          sourceId: source.id,
          sourceName: source.name,
        }
      } catch (error) {
        // 网络层错误给一句人话，技术细节放到 code 里，不往响应里塞堆栈
        const raw = String(error?.message ?? error)
        const friendly = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(raw)
          ? '无法连接到声源服务（地址不可达或网络受限），请检查 baseUrl'
          : raw
        payload = { ok: false, code: 'SPEAK_ERROR', message: friendly }
      }
      json(res, 200, payload)
    },
  }), 'fish-pet: speak route')

  // ---- 合成结果音频 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SPEAK_AUDIO_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
      const url = new URL(req.url ?? '', 'http://localhost')
      const h = url.searchParams.get('h') ?? ''
      // 严格校验：只允许 24 位十六进制，杜绝路径穿越
      if (!/^[a-f0-9]{24}$/.test(h)) { res.writeHead(400); res.end('bad hash'); return }
      try {
        // 克隆结果是 wav，在线合成是 mp3；按实际存在的文件返回
        let buf = null
        let mime = 'audio/mpeg'
        try {
          buf = await readFile(new URL(`${h}.audio`, ttsDir))
        } catch {
          buf = await readFile(new URL(`${h}.wav`, ttsDir))
          mime = 'audio/wav'
        }
        res.writeHead(200, {
          'content-type': mime,
          'content-length': String(buf.length),
          'cache-control': 'public, max-age=86400',
        })
        res.end(buf)
      } catch {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        res.end('{"ok":false,"code":"NOT_FOUND"}')
      }
    },
  }), 'fish-pet: speak audio route')

  // ---- 声音克隆：上传参考音视频，建立克隆声源 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLONE_PATH,
    async handler(req, res) {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
      try {
        // 上限 64MB：短视频足够
        const buf = await readBody(req, 64 * 1024 * 1024)
        if (buf.length < 1024) {
          json(res, 400, { ok: false, code: 'TOO_SMALL', message: '文件太小，无法作为参考音频' })
          return
        }

        const modelDir = resolveCloneModelDir(config)
        if (!modelDir) {
          json(res, 200, {
            ok: false,
            code: 'NO_MODEL_DIR',
            message: '未找到克隆模型目录，请按 README 下载模型后设置 cloneModelDir',
          })
          return
        }

        const cloneDir = new URL('clone/', dataDir)
        await mkdir(cloneDir, { recursive: true })
        const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        const refName = `ref-${stamp}.wav`
        const refPath = fileURLToPath(new URL(refName, cloneDir))
        const srcPath = fileURLToPath(new URL(`src-${stamp}.bin`, cloneDir))
        await writeFile(srcPath, buf, { mode: 0o600 })

        const scriptPath = fileURLToPath(new URL('./scripts/clone_tts.py', import.meta.url))
        const args = [
          scriptPath, 'prepare',
          '--input', srcPath,
          '--out-wav', refPath,
          '--model-dir', modelDir,
        ]
        const out = await runPython(config, args)
        // 源文件用完即删，避免占空间
        try { await rm(srcPath, { force: true }) } catch { /* ignore */ }

        if (!out.ok) {
          json(res, 200, { ok: false, code: out.code, message: out.message })
          return
        }

        json(res, 200, {
          ok: true,
          refWav: refName,
          refText: out.text ?? '',
          textSource: out.textSource ?? 'none',
          duration: out.duration ?? null,
          // 自动识别不出文本时，提示用户手填
          needsText: !(out.text ?? '').trim(),
        })
      } catch (error) {
        json(res, 200, {
          ok: false,
          code: error?.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'CLONE_FAILED',
          message: error?.code === 'TOO_LARGE' ? '文件超过 64MB' : String(error?.message ?? error),
        })
      }
    },
  }), 'fish-pet: voice clone route')

  // ---- 前端错误上报：把手机上看不到的报错收集起来 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLIENT_ERROR_PATH,
    async handler(req, res) {
      if (req.method === 'GET') {
        // 读取最近 20 条，供排查
        try {
          const raw = await readFile(clientErrorFile, 'utf8')
          const lines = raw.trim().split('\n').filter(Boolean).slice(-20)
          json(res, 200, { ok: true, items: lines.map(l => { try { return JSON.parse(l) } catch { return { raw: l } } }) })
        } catch {
          json(res, 200, { ok: true, items: [] })
        }
        return
      }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); res.end(); return }
      try {
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}')
        const entry = {
          at: new Date().toISOString(),
          where: String(body.where ?? '').slice(0, 40),
          message: String(body.message ?? '').slice(0, 300),
          stack: String(body.stack ?? '').slice(0, 1500),
          componentStack: String(body.componentStack ?? '').slice(0, 800),
        }
        // 只保留最近 50 行，避免日志无限增长
        let lines = []
        try {
          lines = (await readFile(clientErrorFile, 'utf8')).trim().split('\n').filter(Boolean)
        } catch { /* 首次没有文件 */ }
        lines.push(JSON.stringify(entry))
        await writeFile(clientErrorFile, lines.slice(-50).join('\n') + '\n', { mode: 0o600 })
        json(res, 200, { ok: true })
      } catch (error) {
        json(res, 200, { ok: false, message: String(error?.message ?? error) })
      }
    },
  }), 'fish-pet: client error route')

  // ---- Live2D：模型列表 / 上传 / 删除 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LIVE2D_MODELS_PATH,
    async handler(req, res) {
      const url = new URL(req.url ?? '', 'http://localhost')

      if (req.method === 'GET') {
        const models = await listLive2DModels()
        json(res, 200, { ok: true, models })
        return
      }

      if (req.method === 'POST') {
        let tmpDir = null
        try {
          const buf = await readBody(req, MAX_LIVE2D_ZIP_BYTES + 1024)
          if (buf.length < 22) {
            json(res, 400, { ok: false, code: 'BAD_ARCHIVE', message: '上传内容不是有效的 zip 文件' })
            return
          }
          const rawName = url.searchParams.get('name') ?? ''
          const fallbackName = rawName.replace(/\.zip$/i, '')
          const prepared = prepareModelPackage(buf, { fallbackName })

          await mkdir(live2dDir, { recursive: true })
          const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
          const tmpName = `.tmp-${prepared.id}-${stamp}`
          tmpDir = fileURLToPath(new URL(`${tmpName}/`, live2dDir))
          const modelRoot = join(tmpDir, 'model')
          await mkdir(modelRoot, { recursive: true })
          for (const file of prepared.files) {
            // prepared 的路径已经过 sanitizeZipPath；这里再用前缀兜一层
            const target = resolvePath(modelRoot, file.path)
            if (target !== modelRoot && !target.startsWith(modelRoot + sep)) {
              throw new Live2DError('BAD_PATH', `模型文件路径越界：${file.path}`)
            }
            await mkdir(dirname(target), { recursive: true })
            await writeFile(target, file.data, { mode: 0o600 })
          }
          const meta = { ...prepared.meta, uploadedAt: new Date().toISOString() }
          await writeFile(join(tmpDir, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o600 })

          // 先完整写进临时目录，再原子替换，避免上传中断留下半个模型
          const destDir = fileURLToPath(new URL(`${prepared.id}/`, live2dDir))
          await rm(destDir, { recursive: true, force: true })
          await rename(tmpDir, destDir)
          tmpDir = null
          json(res, 200, { ok: true, model: meta })
        } catch (error) {
          if (tmpDir) {
            await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
          }
          if (error?.code === 'TOO_LARGE' && error?.name !== 'Live2DError') {
            json(res, 413, { ok: false, code: 'TOO_LARGE', message: `压缩包超过 ${Math.round(MAX_LIVE2D_ZIP_BYTES / 1024 / 1024)}MB` })
            return
          }
          if (error instanceof Live2DError) {
            json(res, 400, { ok: false, code: error.code, message: error.message })
            return
          }
          json(res, 500, {
            ok: false,
            code: 'UPLOAD_FAILED',
            message: `模型保存失败：${error?.message ?? error}`,
          })
        }
        return
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') ?? ''
        if (!LIVE2D_MODEL_ID_PATTERN.test(id)) {
          json(res, 400, { ok: false, code: 'BAD_MODEL_ID', message: '模型 id 不合法' })
          return
        }
        try {
          await rm(fileURLToPath(new URL(`${id}/`, live2dDir)), { recursive: true, force: true })
        } catch (error) {
          json(res, 500, { ok: false, code: 'DELETE_FAILED', message: String(error?.message ?? error) })
          return
        }
        // 删掉的是当前模型时，把设置回退到图片模式，避免前端加载一个不存在的模型
        try {
          const current = await store.read()
          if (current.live2dModel === id) {
            await store.write({ ...current, live2dModel: '', appearance: 'image' })
          }
        } catch { /* 设置回退失败不影响删除结果 */ }
        json(res, 200, { ok: true, models: await listLive2DModels() })
        return
      }

      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, POST, DELETE' })
      res.end('{"ok":false,"code":"METHOD_NOT_ALLOWED"}')
    },
  }), 'fish-pet: live2d models route')

  // ---- Live2D：模型静态文件（路径式，保证模型内部相对引用可解析） ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: LIVE2D_MODEL_BASE,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      const url = new URL(req.url ?? '', 'http://localhost')
      let rest
      try {
        rest = decodeURIComponent(url.pathname.slice(LIVE2D_MODEL_BASE.length + 1))
      } catch {
        json(res, 400, { ok: false, code: 'BAD_PATH', message: '模型路径编码不合法' })
        return
      }
      const slash = rest.indexOf('/')
      if (slash <= 0 || slash === rest.length - 1) {
        json(res, 404, { ok: false, code: 'NOT_FOUND', message: '模型文件不存在' })
        return
      }
      const id = rest.slice(0, slash)
      const relative = rest.slice(slash + 1)
      await serveLive2DFile(res, id, relative)
    },
  }), 'fish-pet: live2d model file route')

  // ---- Live2D：运行时脚本（PixiJS / Cubism Core / 显示库） ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: LIVE2D_RUNTIME_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      const url = new URL(req.url ?? '', 'http://localhost')
      const name = url.pathname.slice(LIVE2D_RUNTIME_PATH.length + 1)
      const type = LIVE2D_RUNTIME_FILES[name]
      if (!type) {
        json(res, 404, { ok: false, code: 'NOT_FOUND', message: '运行时文件不存在' })
        return
      }
      try {
        const buf = await readFile(new URL(name, LIVE2D_RUNTIME_DIR))
        res.writeHead(200, {
          'content-type': type,
          'content-length': String(buf.length),
          // 运行时随插件版本更新；一天缓存足够，且不会长期粘住旧版本
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        })
        res.end(buf)
      } catch (error) {
        json(res, 500, { ok: false, code: 'RUNTIME_MISSING', message: String(error?.message ?? error) })
      }
    },
  }), 'fish-pet: live2d runtime route')

  // ---- 桌宠动画形象：清单 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ANIMATIONS_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' })
        res.end('{"ok":false,"code":"METHOD_NOT_ALLOWED"}')
        return
      }
      const names = await scanAnimationClips()
      const matteNames = await scanAnimationMatteClips()
      const manifest = buildAnimationManifest(names, { matteNames })
      json(res, 200, {
        ...manifest,
        // 素材目录只暴露相对位置，不把绝对路径发给前端
        dir: config.animationDir ? 'custom' : ANIMATION_SUBDIR,
        scanError: animationScan.error,
        matteScanError: animationMatteScan.error,
      })
    },
  }), 'fish-pet: animations route')

  /**
   * 注册一个动画文件路由：名字只认扫描结果，杜绝路径拼接。
   * @param {string} routePath
   * @param {boolean} matte - 是否读白底版本。
   * @param {string} label
   */
  const registerAnimationFileRoute = (routePath, matte, label) => ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const url = new URL(req.url ?? '', 'http://localhost')
      let raw = url.pathname.slice(routePath.length + 1)
      try {
        raw = decodeURIComponent(raw)
      } catch {
        json(res, 400, { ok: false, code: 'BAD_PATH', message: '动画名编码不合法' })
        return
      }
      if (!raw.toLowerCase().endsWith(ANIMATION_EXT)) {
        json(res, 404, { ok: false, code: 'NOT_FOUND', message: '动画文件不存在' })
        return
      }
      const name = normalizeClipName(raw.slice(0, -ANIMATION_EXT.length))
      if (!name) {
        json(res, 400, { ok: false, code: 'BAD_PATH', message: '动画名不合法' })
        return
      }
      const buf = await readAnimationClip(name, matte)
      if (!buf) {
        json(res, 404, { ok: false, code: 'CLIP_MISSING', message: '动画文件不存在' })
        return
      }
      res.writeHead(200, {
        'content-type': 'video/webm',
        'content-length': String(buf.length),
        // 素材不随插件版本变：一天缓存，换素材后刷新页面即重新拉
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      })
      if (req.method === 'HEAD') res.end()
      else res.end(buf)
    },
  }), label)

  // ---- 桌宠动画形象：单个 webm 文件（透明原版 + 白底回退版） ----
  registerAnimationFileRoute(ANIMATION_BASE_PATH, false, 'fish-pet: animation file route')
  registerAnimationFileRoute(ANIMATION_MATTE_BASE_PATH, true, 'fish-pet: animation matte file route')

  // ==================== 每日声源校准 ====================
  //
  // 用户诉求：每天用二十分钟搜「大肥鱼」相关音频，把和基准音色一致、
  // 且带可靠文本的片段加成「独立」声源；绝不改动基准/当前声源。

  /** 运行中的校准任务（内存态）。 */
  const harvestJob = { running: false, startedAt: 0, trigger: '' }

  /** 校准脚本路径。 */
  const harvestScript = fileURLToPath(new URL('./scripts/voice_harvest.py', import.meta.url))

  /** 写状态：先读再合并，避免覆盖并发写入的字段。 */
  const patchHarvestState = async patch => {
    const state = await harvestStore.read()
    return harvestStore.write({ ...state, ...patch })
  }

  /** 记一条待展示通知。 */
  const setHarvestNotification = async (level, text, detail) => {
    const now = Date.now()
    return patchHarvestState({
      notification: {
        id: `hv-${now.toString(36)}`,
        at: now,
        level,
        text: String(text ?? '').slice(0, 120),
        detail: String(detail ?? '').slice(0, 300),
      },
    })
  }

  /**
   * 解析基准音色：优先用户从视频抽的 anchor，其次当前 zipvoice 声源。
   * 基准只读，永远不会被每日校准改写。
   */
  const resolveHarvestAnchor = async () => {
    const state = await harvestStore.read()
    if (state.anchor && typeof state.anchor.wav === 'string' && /^[A-Za-z0-9_.-]+$/.test(state.anchor.wav)) {
      const p = fileURLToPath(new URL(state.anchor.wav, harvestDir))
      if (existsSync(p)) {
        return { wav: p, text: String(state.anchor.text ?? ''), source: 'custom', title: state.anchor.title ?? '' }
      }
    }
    const { sources, currentId } = await loadVoices()
    const cur = sources.find(s => s.id === currentId) ?? sources.find(s => s.type === 'zipvoice' && s.refWav)
    if (cur && cur.type === 'zipvoice' && cur.refWav) {
      const p = fileURLToPath(new URL(cur.refWav, cloneDir))
      if (existsSync(p)) {
        return { wav: p, text: String(cur.refText ?? ''), source: 'voice', title: cur.name }
      }
    }
    return null
  }

  /**
   * 把达标候选加成独立声源（id 前缀 auto-）。
   * 不改 currentId；自动声源最多保留 8 条，旧的连同参考音频一起删。
   */
  const applyHarvestCandidates = async (report, settings, day, runDir) => {
    const picked = pickAutoSources(report?.candidates, {
      minSim: Number(settings.harvestMinSim) || 0.65,
      max: 2,
    })
    if (picked.length === 0) return []
    await mkdir(cloneDir, { recursive: true })
    const doc = await voicesStore.read()
    let sources = normalizeVoiceSources(doc.sources)
    const created = []
    for (let i = 0; i < picked.length; i++) {
      const c = picked[i]
      if (typeof c.wav !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(c.wav)) continue
      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
      const refName = `ref-auto-${stamp}.wav`
      try {
        await copyFile(join(runDir, c.wav), fileURLToPath(new URL(refName, cloneDir)))
      } catch { continue }
      const src = normalizeVoiceSource({
        id: `auto-${stamp}`,
        name: autoSourceName(c, day, i + 1),
        type: 'zipvoice',
        lang: 'zh',
        refWav: refName,
        refText: c.text,
      })
      if (!src) continue
      sources.push(src)
      created.push({ id: src.id, name: src.name, sim: Number(c.sim) || 0, bvid: c.bvid ?? '' })
    }
    if (created.length === 0) return []
    // 只裁剪自动声源，用户自己的声源一条都不碰
    const autos = sources.filter(s => String(s.id).startsWith('auto-'))
    if (autos.length > 8) {
      const drop = autos.slice(0, autos.length - 8)
      for (const d of drop) {
        try { await rm(new URL(d.refWav, cloneDir), { force: true }) } catch { /* ignore */ }
      }
      const dropIds = new Set(drop.map(d => d.id))
      sources = sources.filter(s => !dropIds.has(s.id))
    }
    await voicesStore.write({ sources, currentId: doc.currentId })
    return created
  }

  /** 跑一轮校准（约 20 分钟）。手动/定时都走这里。 */
  const runHarvest = async (trigger = 'schedule') => {
    if (harvestJob.running) return { ok: false, code: 'BUSY', message: '校准正在运行' }
    const settings = await store.read()
    if (settings.petEnabled === false) return { ok: false, code: 'PET_OFF', message: '肥鱼已关闭' }
    if (settings.harvestEnabled === false) return { ok: false, code: 'HARVEST_OFF', message: '每日校准已关闭' }

    const anchor = await resolveHarvestAnchor()
    if (!anchor) {
      await setHarvestNotification('error', '今日声源校准失败', '找不到基准音色：先添加一个本地克隆声源，或在菜单里设置基准视频')
      return { ok: false, code: 'NO_ANCHOR' }
    }
    const modelDir = resolveCloneModelDir(config)
    if (!modelDir) {
      await setHarvestNotification('error', '今日声源校准失败', '找不到克隆模型目录，请先在 README 里下载模型')
      return { ok: false, code: 'NO_MODEL_DIR' }
    }

    const budgetSec = Math.round(Math.min(60, Math.max(5, Number(settings.harvestBudgetMin) || 20)) * 60)
    const now = Date.now()
    const runId = `${localDayKey(now)}-${now.toString(36)}`
    const runDir = fileURLToPath(new URL(`${runId}/`, harvestDir))
    try {
      await mkdir(runDir, { recursive: true })
    } catch (error) {
      await setHarvestNotification('error', '今日声源校准失败', `创建输出目录失败：${error?.message ?? error}`)
      return { ok: false, code: 'MKDIR_FAILED' }
    }

    const state = await harvestStore.read()
    const seenFile = fileURLToPath(new URL('seen.json', harvestDir))
    try {
      await writeFile(seenFile, JSON.stringify(state.seenBvids ?? []), { mode: 0o600 })
    } catch { /* 没有 seen 也能跑 */ }

    harvestJob.running = true
    harvestJob.startedAt = now
    harvestJob.trigger = trigger
    await patchHarvestState({ running: true, runStartedAt: now })

    try {
      const out = await runPython(config, [
        harvestScript, 'run',
        '--anchor-wav', anchor.wav,
        '--keywords', settings.harvestKeywords,
        '--out-dir', runDir,
        '--model-dir', modelDir,
        '--threshold', String(settings.harvestMinSim ?? 0.65),
        '--budget-sec', String(budgetSec),
        '--run-id', runId,
        '--seen-json', seenFile,
        ...(state.anchor?.bvid ? ['--exclude-bvid', String(state.anchor.bvid)] : []),
      ], (budgetSec + 300) * 1000)

      const finishedAt = Date.now()
      const day = localDayKey(finishedAt)
      let applied = []
      if (out.ok === true) {
        try {
          applied = await applyHarvestCandidates(out, settings, day, runDir)
        } catch (error) {
          out.warn = `加成声源失败：${error?.message ?? error}`
        }
      }
      const summary = summarizeReport(out)
      const fresh = await harvestStore.read()
      const seen = new Set(fresh.seenBvids ?? [])
      for (const b of (out?.stats?.tried ?? [])) {
        if (typeof b === 'string' && b.length < 24) seen.add(b)
      }
      const report = out.ok === true
        ? {
            runId,
            at: finishedAt,
            elapsedSec: out.elapsedSec ?? null,
            threshold: out.threshold ?? null,
            stats: out.stats ?? null,
            candidates: (Array.isArray(out.candidates) ? out.candidates : []).slice(0, 8).map(c => ({
              id: c.id,
              bvid: c.bvid,
              title: c.title,
              author: c.author,
              sim: c.sim,
              duration: c.duration,
              start: c.start,
              text: c.text,
              wav: c.wav,
            })),
            applied,
            warn: out.warn ?? null,
          }
        : null
      await harvestStore.write({
        ...fresh,
        running: false,
        lastRunDay: day,
        lastRunAt: finishedAt,
        lastReport: report,
        lastError: out.ok === true ? null : { at: finishedAt, code: out.code ?? 'FAILED', message: out.message ?? '' },
        seenBvids: [...seen].slice(-300),
        notification: {
          id: `hv-${finishedAt.toString(36)}`,
          at: finishedAt,
          level: summary.level,
          text: String(
            summary.text + (applied.length > 0 ? `，已加成 ${applied.length} 个新声源` : ''),
          ).slice(0, 140),
          detail: String(summary.detail).slice(0, 300),
        },
      })
      try { await rm(seenFile, { force: true }) } catch { /* ignore */ }
      return { ok: out.ok === true, ...out }
    } catch (error) {
      await setHarvestNotification('error', '今日声源校准失败', String(error?.message ?? error))
      return { ok: false, code: 'HARVEST_FAILED', message: String(error?.message ?? error) }
    } finally {
      harvestJob.running = false
      await patchHarvestState({ running: false }).catch(() => {})
    }
  }

  // ---- 校准状态：前端轮询这个端点拿进度、报告和通知 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: HARVEST_PATH,
    async handler(req, res) {
      if (req.method === 'GET') {
        const settings = await store.read()
        const state = await harvestStore.read()
        let anchor = null
        try { anchor = await resolveHarvestAnchor() } catch { anchor = null }
        json(res, 200, {
          ok: true,
          petEnabled: settings.petEnabled !== false,
          harvestEnabled: settings.harvestEnabled !== false,
          running: harvestJob.running,
          startedAt: harvestJob.startedAt || 0,
          at: settings.harvestAt,
          keywords: settings.harvestKeywords,
          budgetMin: settings.harvestBudgetMin,
          minSim: settings.harvestMinSim,
          autoAdd: settings.harvestAutoAdd !== false,
          anchor: anchor
            ? { source: anchor.source, title: anchor.title ?? '', text: anchor.text ?? '' }
            : null,
          lastRunDay: state.lastRunDay ?? '',
          lastRunAt: state.lastRunAt ?? 0,
          lastReport: state.lastReport ?? null,
          lastError: state.lastError ?? null,
          notification: state.notification ?? null,
        })
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST' })
        res.end()
        return
      }
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
        const action = String(body.action ?? '')

        if (action === 'run') {
          if (harvestJob.running) { json(res, 409, { ok: false, code: 'BUSY', message: '校准正在运行' }); return }
          // 不阻塞请求：20 分钟的任务用状态轮询看进度
          void runHarvest('manual')
          json(res, 200, { ok: true, started: true })
          return
        }

        if (action === 'ack') {
          await patchHarvestState({ notification: null })
          json(res, 200, { ok: true })
          return
        }

        if (action === 'anchor') {
          const input = String(body.input ?? '').trim()
          const bvOk = /^BV[0-9A-Za-z]{10}$/.test(input)
          const urlOk = /^https?:\/\/(?:www\.)?(?:bilibili\.com|b23\.tv)\/[\w./?=&%-]+$/.test(input)
          if (!bvOk && !urlOk) {
            json(res, 400, {
              ok: false,
              code: 'BAD_ANCHOR_INPUT',
              message: '只接受 BV 号或 bilibili.com / b23.tv 链接',
            })
            return
          }
          const modelDir = resolveCloneModelDir(config)
          if (!modelDir) { json(res, 200, { ok: false, code: 'NO_MODEL_DIR', message: '找不到克隆模型目录' }); return }
          await mkdir(harvestDir, { recursive: true })
          const outWav = fileURLToPath(new URL('anchor.wav', harvestDir))
          const out = await runPython(config, [
            harvestScript, 'anchor',
            '--input', input,
            '--out-wav', outWav,
            '--model-dir', modelDir,
          ], 300000)
          if (out.ok !== true) { json(res, 200, out); return }
          await patchHarvestState({
            anchor: {
              wav: 'anchor.wav',
              text: out.text ?? '',
              title: out.title ?? '',
              bvid: out.bvid ?? '',
              at: Date.now(),
            },
          })
          json(res, 200, { ok: true, anchor: out })
          return
        }

        json(res, 400, { ok: false, code: 'BAD_ACTION', message: '未知操作' })
      } catch (error) {
        json(res, 400, {
          ok: false,
          code: error?.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'BAD_REQUEST',
          message: String(error?.message ?? error),
        })
      }
    },
  }), 'fish-pet: harvest route')

  // ---- 校准候选试听：<runId>/<name>.wav，只允许状态里出现过的目录 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: HARVEST_AUDIO_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
      const url = new URL(req.url ?? '', 'http://localhost')
      const run = url.searchParams.get('run') ?? ''
      const name = url.searchParams.get('f') ?? ''
      if (!/^[0-9A-Za-z-]{6,40}$/.test(run) || !/^[A-Za-z0-9_.-]{1,80}\.wav$/.test(name)) {
        json(res, 400, { ok: false, code: 'BAD_PARAM' })
        return
      }
      const state = await harvestStore.read()
      if (!state.lastReport || state.lastReport.runId !== run) {
        json(res, 404, { ok: false, code: 'NOT_FOUND' })
        return
      }
      try {
        const buf = await readFile(new URL(`${run}/${name}`, harvestDir))
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(buf.length),
          'cache-control': 'public, max-age=3600',
        })
        res.end(buf)
      } catch {
        json(res, 404, { ok: false, code: 'NOT_FOUND' })
      }
    },
  }), 'fish-pet: harvest audio route')

  // ---- 总开关：客户端「一键关闭肥鱼」同步到这里 ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: POWER_PATH,
    async handler(req, res) {
      if (req.method === 'GET') {
        const settings = await store.read()
        json(res, 200, { ok: true, enabled: settings.petEnabled !== false })
        return
      }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); res.end(); return }
      try {
        const body = JSON.parse((await readBody(req, 8 * 1024)).toString('utf8') || '{}')
        const enabled = body.enabled !== false
        const cur = await store.read()
        await store.write({ ...cur, petEnabled: enabled })
        json(res, 200, { ok: true, enabled })
      } catch (error) {
        json(res, 400, { ok: false, code: 'BAD_REQUEST', message: String(error?.message ?? error) })
      }
    },
  }), 'fish-pet: power route')

  // ---- 调度器：每分钟看一眼「今天 10 点后跑过没有」 ----
  ctx.effect(() => {
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const settings = await store.read()
        if (settings.petEnabled === false || settings.harvestEnabled === false) return
        if (harvestJob.running) return
        const state = await harvestStore.read()
        if (!isHarvestDue({ now: Date.now(), lastRunDay: state.lastRunDay, at: settings.harvestAt })) return
        void runHarvest('schedule')
      } catch { /* 调度异常不影响桌宠 */ }
    }
    const kickoff = setTimeout(tick, 8000)
    const timer = setInterval(tick, 60000)
    return () => {
      stopped = true
      clearTimeout(kickoff)
      clearInterval(timer)
    }
  }, 'fish-pet: harvest scheduler')

  ctx.logger?.('fish-pet').info(
    '桌宠端点已就绪：%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s',
    BALANCE_PATH, PET_IMG_PATH, WEATHER_PATH, SETTINGS_PATH, CUSTOM_IMAGE_PATH, SOUND_PATH,
    SOUND_STATUS_PATH, VOICES_PATH, VOICE_CATALOG_PATH, SPEAK_PATH, SPEAK_AUDIO_PATH,
    LIVE2D_MODELS_PATH, LIVE2D_MODEL_BASE, LIVE2D_RUNTIME_PATH,
    ANIMATIONS_PATH, ANIMATION_BASE_PATH, ANIMATION_MATTE_BASE_PATH,
  )
}
