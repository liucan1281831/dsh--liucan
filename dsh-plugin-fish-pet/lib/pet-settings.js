/**
 * 纯逻辑：桌宠用户设置与天气映射。
 *
 * 与 cordis 解耦，便于离线单测。
 *
 * @module dsh-plugin-fish-pet/lib/pet-settings
 */

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
  /** 摸摸时的台词；留空则用内置撒娇语。 */
  phrases: [],
  /** 点击音效开关。 */
  soundEnabled: false,
  /** 音效音量 0–1。 */
  soundVolume: 0.5,
  /** 音效 URL（由上传端点返回）。 */
  soundUrl: '',
  /** 天气显示开关。 */
  weatherEnabled: true,
  /** 天气城市名（用于地理编码）。 */
  weatherCity: '北京',
  /** 打开菜单的快捷键，形如 ctrl+shift+p；留空则用默认。 */
  shortcut: 'ctrl+shift+p',
}

/** 设置项的校验范围。 */
const LIMITS = {
  size: [40, 200],
  opacity: [0, 1],
  soundVolume: [0, 1],
  phrases: 30,
  phraseLength: 60,
  cityLength: 32,
}

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

  // 自定义短语：去除空项、限长限量
  const phrases = Array.isArray(input.phrases) ? input.phrases : []
  out.phrases = phrases
    .filter(p => typeof p === 'string')
    .map(p => p.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.phraseLength))
    .filter(p => p.length > 0)
    .slice(0, LIMITS.phrases)

  return out
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
