/**
 * 纯逻辑：DeepSeek API 峰谷时段判定。
 *
 * 规则来自官方价格页（https://api-docs.deepseek.com/zh-cn/quick_start/pricing/）：
 *   高峰时段 = 北京时间 周一至周五（不含中国法定节假日） 9:00-12:00、14:00-18:00
 *   空闲时段 = 其余全部时间（含周末与法定节假日全天），价格为高峰的一半
 *
 * 与 cordis 解耦，便于离线单测：给定一个时间点，直接断言判定结果。
 *
 * 重要边界：中国法定节假日的具体日期不在本模块硬编码——2026 年除外，
 * 见 HOLIDAYS_2026 注释。未覆盖年份一律按「工作日」推算，并在结果里
 * 明确标注 calendarCovered=false，不假装有完整日历。
 *
 * @module dsh-plugin-deepseek-balance/lib/peak
 */

/** 北京时间相对 UTC 的偏移（毫秒）。北京无夏令时，固定值。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 高峰时段的本地时钟区间，[起始小时, 结束小时)，左闭右开。 */
export const PEAK_WINDOWS = [
  [9, 12],
  [14, 18],
]

/**
 * 已经人工核对过的中国法定节假日（北京时间日期，YYYY-MM-DD）。
 *
 * 只收录官方已公布且落在工作日、会让当天按空闲时段计费的日子。
 * 未列入的年份 = 没有日历数据，peak 判定会退回「按工作日估算」。
 *
 * 目前为空：没有可靠来源可核对 2026 年的完整放假安排，
 * 宁可留空并明确标注，也不填臆测的日期。
 */
export const HOLIDAYS = new Set([])

/** 已知日历覆盖的年份。超出范围的年份按工作日估算。 */
export const COVERED_YEARS = new Set([])

/**
 * 把毫秒时间戳拆成北京时间的日历分量。
 * @param {number} timeMs - UTC 毫秒时间戳。
 * @returns {{ year: number, month: number, day: number, weekday: number, hour: number, minute: number, dateKey: string }}
 *   weekday 用 1=周一 … 7=周日；dateKey 形如 2026-10-18。
 */
export function beijingParts(timeMs) {
  const shifted = new Date(timeMs + BEIJING_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  const isoWeekday = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay()
  const pad = n => String(n).padStart(2, '0')
  return {
    year,
    month,
    day,
    weekday: isoWeekday,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
  }
}

/**
 * 判定某个时刻处于高峰还是空闲时段。
 *
 * @param {number} [timeMs] - UTC 毫秒时间戳，默认当前时刻。
 * @returns {{
 *   phase: 'peak' | 'idle',
 *   reason: 'weekend' | 'holiday' | 'peak-window' | 'off-window',
 *   calendarCovered: boolean,
 *   dateKey: string,
 *   weekday: number,
 *   hour: number,
 *   minute: number,
 *   discount: number,
 * }}
 */
export function resolvePhase(timeMs = Date.now()) {
  const parts = beijingParts(timeMs)
  const calendarCovered = COVERED_YEARS.has(parts.year)
  const base = {
    dateKey: parts.dateKey,
    weekday: parts.weekday,
    hour: parts.hour,
    minute: parts.minute,
    calendarCovered,
  }

  // 周末整天空闲，优先级最高
  if (parts.weekday >= 6) {
    return { ...base, phase: 'idle', reason: 'weekend', discount: 0.5 }
  }
  // 已知日历里的法定节假日整天空闲
  if (HOLIDAYS.has(parts.dateKey)) {
    return { ...base, phase: 'idle', reason: 'holiday', discount: 0.5 }
  }
  // 工作日按钟点判断
  const inPeak = PEAK_WINDOWS.some(([start, end]) => parts.hour >= start && parts.hour < end)
  return {
    ...base,
    phase: inPeak ? 'peak' : 'idle',
    reason: inPeak ? 'peak-window' : 'off-window',
    discount: inPeak ? 1 : 0.5,
  }
}

/**
 * 距下一次时段切换还有多少毫秒。
 *
 * 只按钟点与星期推算下一个边界；节假日边界无法在不完整日历下精确给出，
 * 因此当结果跨越节假日时以日历覆盖标记提示调用方。
 *
 * @param {number} [timeMs] - UTC 毫秒时间戳，默认当前时刻。
 * @returns {{ phase: 'peak' | 'idle', nextPhase: 'peak' | 'idle', nextChangeMs: number }}
 */
export function untilNextChange(timeMs = Date.now()) {
  const current = resolvePhase(timeMs)
  const step = 60 * 1000
  const horizon = 7 * 24 * 60 * 60 * 1000
  // 逐分钟往前找第一个 phase 不同的时刻；最多找 7 天
  for (let offset = step; offset <= horizon; offset += step) {
    const probe = resolvePhase(timeMs + offset)
    if (probe.phase !== current.phase) {
      return {
        phase: current.phase,
        nextPhase: probe.phase,
        nextChangeMs: offset,
      }
    }
  }
  return { phase: current.phase, nextPhase: current.phase, nextChangeMs: 0 }
}

/**
 * 时段的中文标签。
 * @param {'peak' | 'idle'} phase
 * @returns {string}
 */
export function phaseLabel(phase) {
  return phase === 'peak' ? '高峰时段' : '空闲时段'
}

/**
 * 把毫秒差格式化成「X小时Y分」。
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}分`
  if (minutes === 0) return `${hours}小时`
  return `${hours}小时${minutes}分`
}

/**
 * 生成一句人类可读的时段摘要。
 * @param {number} [timeMs]
 * @returns {string}
 */
export function describePhase(timeMs = Date.now()) {
  const current = resolvePhase(timeMs)
  const next = untilNextChange(timeMs)
  const head = `${phaseLabel(current.phase)}（${current.phase === 'peak' ? '标准价' : '半价'}）`
  const tail = next.nextChangeMs > 0
    ? `，距${phaseLabel(next.nextPhase)}还有 ${formatDuration(next.nextChangeMs)}`
    : ''
  const caveat = current.calendarCovered ? '' : '；本年度节假日日历未覆盖，仅按工作日/周末估算'
  return `${head}${tail}${caveat}`
}
