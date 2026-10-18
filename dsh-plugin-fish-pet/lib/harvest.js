/**
 * 纯逻辑：每日声源校准（harvest）。
 *
 * 这里只放「不碰文件、不联网」的判定与格式化，便于离线单测：
 *  - 关键词 / 时间的规范化（用户输入一律当不可信）
 *  - 「今天该不该跑」的调度判定（10:00 之后首次、跨天补跑）
 *  - 抓取报告的摘要文案（给桌宠通知用）
 *
 * @module dsh-plugin-fish-pet/lib/harvest
 */

/** 关键词数量与单条长度上限。 */
export const KEYWORD_LIMITS = { count: 8, length: 24 }

/** 预算与阈值的允许区间。 */
export const HARVEST_LIMITS = {
  budgetMin: [5, 60],
  minSim: [0.4, 0.95],
}

/** 默认运行时刻：每天 10:00 之后首次打开 DSH 时跑。 */
export const DEFAULT_HARVEST_AT = '10:00'

/** 默认关键词：覆盖「大肥鱼」相关音频的主要叫法。 */
export const DEFAULT_HARVEST_KEYWORDS = '大肥鱼 唱歌, 大肥鱼 音频, 肥鱼 唱歌, 大肥鱼 献唱, 大肥鱼 deepseek'

/**
 * 本地日期键，形如 2026-10-18。用本地时区，和用户看到的「今天」一致。
 * @param {number} [at] - 时间戳（毫秒）。
 * @returns {string}
 */
export function localDayKey(at = Date.now()) {
  const d = new Date(at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 校验并规范化 HH:mm；非法输入回退到默认值。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeHarvestAt(value) {
  if (typeof value !== 'string') return DEFAULT_HARVEST_AT
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!m) return DEFAULT_HARVEST_AT
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`
}

/**
 * HH:mm → 当天第几分钟。
 * @param {string} hhmm
 * @returns {number}
 */
export function minutesOfDay(hhmm) {
  const [h, m] = normalizeHarvestAt(hhmm).split(':')
  return Number(h) * 60 + Number(m)
}

/** 当前时间戳是当天第几分钟。 */
function minutesSinceMidnight(now) {
  const d = new Date(now)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * 关键词列表：按逗号/换行切分，去控制字符、限长限量。
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseKeywords(value) {
  const raw = typeof value === 'string' ? value : ''
  return raw
    .split(/[,，\n]/)
    .map(part => part.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, KEYWORD_LIMITS.length))
    .filter(part => part.length > 0)
    .slice(0, KEYWORD_LIMITS.count)
}

/**
 * 规范化成用于存储/展示的字符串形式。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeKeywords(value) {
  const list = parseKeywords(value)
  return list.length > 0 ? list.join(', ') : DEFAULT_HARVEST_KEYWORDS
}

/**
 * 夹取数字；非数字回退默认值。
 * @param {unknown} value
 * @param {[number, number]} range
 * @param {number} fallback
 * @returns {number}
 */
export function clampNumber(value, [min, max], fallback) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 判定今天是否该跑一次校准。
 *
 * 规则（用户选择）：每天 10:00 之后第一次有机会就跑；当天已跑过则不再跑。
 * 跨天补跑由 lastRunDay 自然覆盖：昨天没跑、今天 10 点后就会触发。
 *
 * @param {{ now?: number, lastRunDay?: string, at?: string }} input
 * @returns {boolean}
 */
export function isHarvestDue({ now = Date.now(), lastRunDay = '', at = DEFAULT_HARVEST_AT } = {}) {
  const today = localDayKey(now)
  if (lastRunDay === today) return false
  return minutesSinceMidnight(now) >= minutesOfDay(at)
}

/**
 * 秒数 → 人类可读，如 183s → "3 分 3 秒"。
 * @param {unknown} sec
 * @returns {string}
 */
export function formatElapsed(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return '0 秒'
  const total = Math.round(n)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m <= 0) return `${s} 秒`
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`
}

/**
 * 把抓取报告压成通知文案。
 * @param {object|null} report
 * @returns {{ level: 'ok'|'warn'|'error', text: string, detail: string, accepted: number }}
 */
export function summarizeReport(report) {
  if (!report || report.ok !== true) {
    return {
      level: 'error',
      text: '今日声源校准失败',
      detail: String(report?.message ?? '抓取脚本没有返回结果'),
      accepted: 0,
    }
  }
  const stats = report.stats && typeof report.stats === 'object' ? report.stats : {}
  const accepted = Array.isArray(report.candidates) ? report.candidates.length : 0
  const threshold = Number(report.threshold)
  const parts = [
    `搜索 ${Number(stats.queued) || 0} 个视频`,
    `试听 ${Number(stats.videosTried) || 0} 个`,
    `切出 ${Number(stats.segments) || 0} 段`,
    `达标 ${accepted} 段`,
    `耗时 ${formatElapsed(report.elapsedSec)}`,
  ]
  if (Number.isFinite(threshold)) parts.push(`阈值 ${threshold.toFixed(2)}`)
  if (stats.stoppedBy === 'budget') parts.push('到预算自动收尾')
  if (stats.stoppedBy === 'max-videos') parts.push('到达视频上限')
  return {
    level: accepted > 0 ? 'ok' : 'warn',
    text: accepted > 0 ? `今日校准时找到 ${accepted} 段达标音频` : '今日没有找到达标音频',
    detail: parts.join('，'),
    accepted,
  }
}

/**
 * 从候选里挑出要自动加成声源的片段（最多 max 条）。
 * @param {Array<{ sim?: number, wav?: string }>} candidates
 * @param {{ minSim?: number, max?: number }} [options]
 * @returns {Array<object>}
 */
export function pickAutoSources(candidates, { minSim = 0.65, max = 2 } = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  const floor = Number.isFinite(Number(minSim)) ? Number(minSim) : 0.65
  const requested = Number(max)
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(5, Math.round(requested))) : 2
  return list
    .filter(c => c && typeof c.wav === 'string' && Number.isFinite(Number(c.sim)) && Number(c.sim) >= floor)
    .sort((a, b) => Number(b.sim) - Number(a.sim))
    .slice(0, limit)
}

/**
 * 自动声源的展示名：带日期与相似度，方便一眼看出是哪天的、像不像。
 * @param {object} candidate
 * @param {string} day
 * @param {number} index - 当天第几条（从 1 开始）。
 * @returns {string}
 */
export function autoSourceName(candidate, day = localDayKey(), index = 1) {
  const sim = Number(candidate?.sim)
  const simText = Number.isFinite(sim) ? `相似度 ${(sim * 100).toFixed(0)}%` : '相似度未知'
  const title = typeof candidate?.title === 'string' ? candidate.title.slice(0, 24) : ''
  const suffix = title ? ` · ${title}` : ''
  return `每日校准 ${day} #${index}（${simText}）${suffix}`.slice(0, 60)
}
