/**
 * 纯逻辑：桌宠用户设置与天气映射。
 *
 * 与 cordis 解耦，便于离线单测。
 *
 * @module dsh-plugin-fish-pet/lib/pet-settings
 */

import {
  DEFAULT_HARVEST_KEYWORDS,
  HARVEST_LIMITS,
  normalizeHarvestAt,
  normalizeKeywords,
} from './harvest.js'

/** 设置默认值。前端 SETTINGS_DEFAULTS 必须与此保持一致。 */
export const SETTINGS_DEFAULTS = {
  /** 桌宠高度（px）。 */
  size: 76,
  /** 卡片背景不透明度 0–1。 */
  opacity: 0.92,
  /** 使用自定义图片而非内置图。 */
  useCustomImage: false,
  /** 自定义图片 URL（由上传端点返回，形如 /api/fish-pet/custom-image?v=...）。 */
  customImageUrl: '',
  /** 外观模式：'image' 图片（内置或自定义），'live2d' Live2D 模型，'dynamic' 伪 Live2D，'animation' 上游透明动画。 */
  appearance: 'image',
  /** 当前 Live2D 模型 id（由上传端点返回，形如 l2d-0123456789ab）；空串表示未选择。 */
  live2dModel: '',
  /** Live2D 模型在画布内的缩放倍率（1 = 自动适配高度）。 */
  live2dScale: 1,
  /** Live2D 模型水平偏移，-0.5～0.5，相对画布宽度。 */
  live2dOffsetX: 0,
  /** Live2D 模型垂直偏移，-0.5～0.5，相对画布高度。 */
  live2dOffsetY: 0,
  /** Live2D 待机动作与点击动作开关。 */
  live2dMotion: true,
  /** Live2D 视线是否跟随鼠标/手指。 */
  live2dLookAt: true,
  /** 动态形象（伪 Live2D）的动画幅度，0 = 几乎静止，1.5 = 很夸张。 */
  dynamicIntensity: 0.6,
  /** 动画形象（上游 webm 素材）是否随机播放小动作。 */
  animRandomEnabled: true,
  /** 动画形象是否在点击时播「点击回应」动作。 */
  animClickEnabled: true,
  /** 摸摸时的台词；留空则用内置撒娇语。 */
  phrases: [],
  /** 点击音效开关。 */
  soundEnabled: false,
  /** 音效音量 0–1。 */
  soundVolume: 0.5,
  /** 音效 URL（由上传端点返回）。 */
  soundUrl: '',
  /** 点击时语音与音效的关系：auto / voice / sound / both。 */
  clickAudioMode: 'auto',
  /** 朗读语种：auto 跟随声源，或 zh / en / ja / ko。 */
  voiceLang: 'auto',
  /** 天气显示开关。 */
  weatherEnabled: true,
  /** 天气城市名（用于地理编码）。 */
  weatherCity: '北京',
  /** 打开菜单的快捷键，形如 ctrl+shift+p；留空则用默认。 */
  shortcut: 'ctrl+shift+p',
  /** 锁定位置：锁定后无法拖动，避免误碰。 */
  locked: false,
  /** 语音总开关：默认关闭，需用户主动开启。 */
  voiceEnabled: false,
  /** 语音音量 0–1。 */
  voiceVolume: 0.8,
  /** 点击桌宠时朗读短语。 */
  speakOnClick: true,
  /** 打开页面时朗读问候语。 */
  greetOnLoad: false,
  /** 问候语列表；为空则用内置。 */
  greetings: [],
  /** 总开关：关闭后桌宠隐藏，语音与每日声源校准一起暂停（服务端也记一份）。 */
  petEnabled: true,
  /** 每日声源校准：每天搜一轮「大肥鱼」相关音频，用说话人相似度过滤。 */
  harvestEnabled: true,
  /** 每天该时刻之后第一次有机会就跑（HH:mm）。 */
  harvestAt: '10:00',
  /** 搜索关键词，逗号分隔；最多 8 条。 */
  harvestKeywords: DEFAULT_HARVEST_KEYWORDS,
  /** 单次校准的时间预算（分钟）。 */
  harvestBudgetMin: 20,
  /** 说话人相似度阈值：低于它的片段直接丢弃，避免别的视频污染声源。 */
  harvestMinSim: 0.65,
  /** 达标片段是否自动加成「独立」声源（永远不会改动当前声源）。 */
  harvestAutoAdd: true,
  /** 基准音色的视频 BV 号 / 链接 / 本地路径；留空则用当前声源当基准。 */
  harvestAnchor: '',
}

/** 缩放的基准高度（px），与默认 size 一致。百分比 = size / SIZE_BASE。 */
export const SIZE_BASE = 76

/** 缩放比例允许范围（相对基准高度）。 */
export const SCALE_LIMITS = [0.5, 2.6]

/** 设置项的校验范围。 */
const LIMITS = {
  // 必须与 SCALE_LIMITS × SIZE_BASE 对齐，否则 50% 缩放（38px）会被夹成 40px，
  // 导致「选了 50% 却变成 52%」的错位。
  size: [38, 198],
  opacity: [0, 1],
  soundVolume: [0, 1],
  phrases: 30,
  phraseLength: 60,
  cityLength: 32,
  live2dScale: [0.4, 2.5],
  live2dOffset: [-0.5, 0.5],
  dynamicIntensity: [0, 1.5],
}

/**
 * 外观模式取值：
 *  - image     静态图片（内置或自定义）
 *  - live2d    真正的 Live2D 模型（需要 .model3.json / .moc3）
 *  - dynamic   把当前图片程序化地动态化（伪 Live2D，不需要模型文件）
 *  - animation 上游 dsh-pet 的透明 webm 动画（素材放 .data/animations/webm）
 */
export const APPEARANCE_MODES = ['image', 'live2d', 'dynamic', 'animation']

/** Live2D 模型 id 的合法形状（与上传端点生成的 id 对齐）。 */
export const LIVE2D_MODEL_ID_PATTERN = /^l2d-[a-z0-9]{6,24}$/

/** 把数字夹到区间内；非数字回退默认值。 */
function clampNumber(value, [min, max], fallback) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 规范化一份用户设置。
 *
 * 逐字段校验并夹取，未知字段丢弃——前端传来的东西一律当作不可信输入。
 *
 * @param {unknown} raw - 原始输入。
 * @returns {typeof SETTINGS_DEFAULTS} 规范化后的设置。
 */
export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const out = { ...SETTINGS_DEFAULTS }

  out.size = clampNumber(input.size, LIMITS.size, SETTINGS_DEFAULTS.size)
  out.opacity = clampNumber(input.opacity, LIMITS.opacity, SETTINGS_DEFAULTS.opacity)
  out.soundVolume = clampNumber(input.soundVolume, LIMITS.soundVolume, SETTINGS_DEFAULTS.soundVolume)

  out.useCustomImage = input.useCustomImage === true
  out.soundEnabled = input.soundEnabled === true
  out.weatherEnabled = input.weatherEnabled !== false
  out.locked = input.locked === true

  // 外观模式：只接受白名单值；未提供时沿用旧字段推导（老设置默认图片模式）
  out.appearance = APPEARANCE_MODES.includes(input.appearance) ? input.appearance : 'image'
  out.live2dModel = typeof input.live2dModel === 'string' && LIVE2D_MODEL_ID_PATTERN.test(input.live2dModel)
    ? input.live2dModel
    : ''
  // 选了 Live2D 模式但没有有效模型 id 时，退回图片模式：
  // 否则前端会渲染一个永远加载失败的空画布。
  if (out.appearance === 'live2d' && out.live2dModel === '') out.appearance = 'image'
  out.live2dScale = clampNumber(input.live2dScale, LIMITS.live2dScale, SETTINGS_DEFAULTS.live2dScale)
  out.live2dOffsetX = clampNumber(input.live2dOffsetX, LIMITS.live2dOffset, SETTINGS_DEFAULTS.live2dOffsetX)
  out.live2dOffsetY = clampNumber(input.live2dOffsetY, LIMITS.live2dOffset, SETTINGS_DEFAULTS.live2dOffsetY)
  out.live2dMotion = input.live2dMotion !== false
  out.live2dLookAt = input.live2dLookAt !== false
  out.dynamicIntensity = clampNumber(input.dynamicIntensity, LIMITS.dynamicIntensity, SETTINGS_DEFAULTS.dynamicIntensity)
  // 动画形象（上游素材）：两个行为开关默认开；素材在不在由前端询问宿主清单
  out.animRandomEnabled = input.animRandomEnabled !== false
  out.animClickEnabled = input.animClickEnabled !== false

  // URL 只允许本站相对路径，拒绝 javascript:、data: 等
  const safeUrl = value =>
    typeof value === 'string' && /^\/api\/fish-pet\/[A-Za-z0-9._?=&-]*$/.test(value) ? value : ''
  out.customImageUrl = safeUrl(input.customImageUrl)
  out.soundUrl = safeUrl(input.soundUrl)

  // 城市名：去控制字符、限长
  const city = typeof input.weatherCity === 'string'
    ? input.weatherCity.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.cityLength)
    : ''
  out.weatherCity = city || SETTINGS_DEFAULTS.weatherCity

  // 快捷键：只保留形如 ctrl+shift+p 的安全字符
  const sc = typeof input.shortcut === 'string'
    ? input.shortcut.toLowerCase().replace(/[^a-z0-9+]/g, '').slice(0, 32)
    : ''
  out.shortcut = sc || SETTINGS_DEFAULTS.shortcut

  // 点击音频模式：只接受四个已知值
  const CAM = ['auto', 'voice', 'sound', 'both']
  out.clickAudioMode = CAM.includes(input.clickAudioMode) ? input.clickAudioMode : 'auto'

  // 朗读语种：只接受已知值
  const LANGS = ['auto', 'zh', 'en', 'ja', 'ko']
  out.voiceLang = LANGS.includes(input.voiceLang) ? input.voiceLang : 'auto'

  out.voiceEnabled = input.voiceEnabled === true
  out.speakOnClick = input.speakOnClick !== false
  out.greetOnLoad = input.greetOnLoad === true
  out.voiceVolume = clampNumber(input.voiceVolume, LIMITS.soundVolume, SETTINGS_DEFAULTS.voiceVolume)

  // 问候语：与短语同样的清洗规则
  const greetings = Array.isArray(input.greetings) ? input.greetings : []
  out.greetings = greetings
    .filter(g => typeof g === 'string')
    .map(g => g.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.phraseLength))
    .filter(g => g.length > 0)
    .slice(0, LIMITS.phrases)

  // 自定义短语：去除空项、限长限量
  const phrases = Array.isArray(input.phrases) ? input.phrases : []
  out.phrases = phrases
    .filter(p => typeof p === 'string')
    .map(p => p.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.phraseLength))
    .filter(p => p.length > 0)
    .slice(0, LIMITS.phrases)

  // ---- 总开关与每日声源校准 ----
  // 总开关默认开：只有明确传 false 才算关闭，避免旧设置文件被误判成关闭。
  out.petEnabled = input.petEnabled !== false
  out.harvestEnabled = input.harvestEnabled !== false
  out.harvestAt = normalizeHarvestAt(input.harvestAt)
  out.harvestKeywords = normalizeKeywords(input.harvestKeywords)
  out.harvestBudgetMin = Math.round(
    clampNumber(input.harvestBudgetMin, HARVEST_LIMITS.budgetMin, SETTINGS_DEFAULTS.harvestBudgetMin),
  )
  out.harvestMinSim = clampNumber(
    input.harvestMinSim, HARVEST_LIMITS.minSim, SETTINGS_DEFAULTS.harvestMinSim,
  )
  out.harvestAutoAdd = input.harvestAutoAdd !== false
  out.harvestAnchor = typeof input.harvestAnchor === 'string'
    ? input.harvestAnchor.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
    : ''

  return out
}

/**
 * 把桌宠高度换算成缩放百分比（相对 SIZE_BASE）。
 * @param {number} size - 桌宠高度（px）。
 * @returns {number} 百分比，四舍五入到整数。
 */
export function sizeToPercent(size) {
  const n = Number(size)
  if (!Number.isFinite(n)) return Math.round(100)
  return Math.round((n / SIZE_BASE) * 100)
}

/**
 * 把缩放百分比换算回桌宠高度，并夹到允许范围内。
 * @param {number} percent - 百分比（100 = 基准）。
 * @returns {number} 高度（px），取整。
 */
export function percentToSize(percent) {
  const n = Number(percent)
  const safe = Number.isFinite(n) ? n : 100
  const minPct = SCALE_LIMITS[0] * 100
  const maxPct = SCALE_LIMITS[1] * 100
  const clampedPct = Math.min(maxPct, Math.max(minPct, safe))
  return Math.round((clampedPct / 100) * SIZE_BASE)
}

/**
 * WMO 天气代码 → 内部标识。
 *
 * Open-Meteo 使用 WMO 4677 编码，这里归并成前端好用的几档。
 * 参考：https://open-meteo.com/en/docs（weather_code 说明）
 *
 * @param {number} code - WMO 代码。
 * @returns {{ key: string, day: boolean, night: boolean }} 分类与可用时段。
 */
export function classifyWeatherCode(code) {
  const n = Number(code)
  if (!Number.isFinite(n)) return { key: 'unknown', day: true, night: true }
  if (n === 0) return { key: 'clear', day: true, night: true }
  if (n === 1) return { key: 'mostly-clear', day: true, night: true }
  if (n === 2) return { key: 'partly-cloudy', day: true, night: true }
  if (n === 3) return { key: 'overcast', day: true, night: true }
  if (n === 45 || n === 48) return { key: 'fog', day: true, night: true }
  if (n >= 51 && n <= 57) return { key: 'drizzle', day: true, night: true }
  if (n >= 61 && n <= 67) return { key: 'rain', day: true, night: true }
  if (n >= 71 && n <= 77) return { key: 'snow', day: true, night: true }
  if (n >= 80 && n <= 82) return { key: 'showers', day: true, night: true }
  if (n === 85 || n === 86) return { key: 'snow-showers', day: true, night: true }
  // WMO 雷暴只有 95/96/99 三档；更大的值属于未知编码，不能当成雷雨
  if (n === 95 || n === 96 || n === 99) return { key: 'thunder', day: true, night: true }
  return { key: 'unknown', day: true, night: true }
}

/**
 * 天气代码的简短中文描述。
 * @param {number} code
 * @returns {string}
 */
export function weatherLabel(code) {
  const { key } = classifyWeatherCode(code)
  const map = {
    clear: '晴',
    'mostly-clear': '晴间多云',
    'partly-cloudy': '多云',
    overcast: '阴',
    fog: '雾',
    drizzle: '小雨',
    rain: '雨',
    snow: '雪',
    showers: '阵雨',
    'snow-showers': '阵雪',
    thunder: '雷雨',
    unknown: '未知',
  }
  return map[key] ?? '未知'
}

/**
 * 把 Open-Meteo 的响应压成前端投影。
 * @param {object} payload - 上游 JSON。
 * @returns {object}
 */
export function projectWeather(payload) {
  const current = payload?.current ?? {}
  const code = current.weather_code
  const temp = Number(current.temperature_2m)
  const humidity = Number(current.relative_humidity_2m)
  const wind = Number(current.wind_speed_10m)
  return {
    ok: true,
    code: Number.isFinite(code) ? code : null,
    kind: classifyWeatherCode(code).key,
    label: weatherLabel(code),
    temperature: Number.isFinite(temp) ? Math.round(temp * 10) / 10 : null,
    humidity: Number.isFinite(humidity) ? Math.round(humidity) : null,
    windSpeed: Number.isFinite(wind) ? Math.round(wind * 10) / 10 : null,
    observedAt: typeof current.time === 'string' ? current.time : null,
    timezone: typeof payload?.timezone === 'string' ? payload.timezone : null,
  }
}

/** 内置撒娇语（临时兜底，前端也有一份同样的列表）。 */
export const DEFAULT_PHRASES = [
  '大肥鱼才不是吃白饭的！(｀・ω・´)',
  '摸摸头…人家会努力的啦～ (´,,•ω•,,)',
  '不要再戳啦，好痒的～ (＞﹏＜)',
  '主人今天也辛苦了呢 (*˘︶˘*)',
  '余额还够哦，放心用吧！(๑•̀ㅂ•́)و✧',
  '我不是大肥鱼…我只是有点圆 (｡•́︿•̀｡)',
  '要记得休息呀，眼睛会累的 (｡･ω･｡)',
  '今天也要加油哦！(ง •̀_•́)ง',
]
