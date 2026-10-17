/**
 * 纯逻辑：DeepSeek API 峰谷时段判定。
 *
 * 规则来自官方价格页（https://api-docs.deepseek.com/zh-cn/quick_start/pricing/）：
 *   高峰时段 = 北京时间 周一至周五（不含中国法定节假日） 9:00-12:00、14:00-18:00
 *   空闲时段 = 其余全部时间（含周末与法定节假日全天），价格为高峰的一半
 *
 * 日历数据来自国务院办公厅《关于2026年部分节假日安排的通知》
 * （国办发明电〔2025〕7号，https://www.gov.cn/zhengce/content/202511/content_7047090.htm）
 *
 * 判定优先级（自上而下，先命中先返回）：
 *   1. 法定节假日            → 空闲（节日当天，含被调休挪用的周末）
 *   2. 调休上班日            → 按工作日走钟点（周六日也可能进高峰）
 *   3. 周末                  → 空闲
 *   4. 工作日                → 按钟点
 *
 * 与 cordis 解耦，便于离线单测：给定一个时间点，直接断言判定结果。
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
 * 中国法定节假日（按北京时间日期），这些日子全天按空闲时段计费。
 *
 * 来源：国办发明电〔2025〕7号。只收录放假日期；调休上班日见 WORKDAY_OVERRIDES。
 * 每条都注明所属节日，便于核对与撤销。
 */
export const HOLIDAYS = new Set([
  // 元旦：1月1日（周四）至3日（周六），共3天
  '2026-01-01', '2026-01-02', '2026-01-03',
  // 春节：2月15日（周日）至23日（周一），共9天
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  // 清明节：4月4日（周六）至6日（周一），共3天
  '2026-04-04', '2026-04-05', '2026-04-06',
  // 劳动节：5月1日（周五）至5日（周二），共5天
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  // 端午节：6月19日（周五）至21日（周日），共3天
  '2026-06-19', '2026-06-20', '2026-06-21',
  // 中秋节：9月25日（周五）至27日（周日），共3天
  '2026-09-25', '2026-09-26', '2026-09-27',
  // 国庆节：10月1日（周四）至7日（周三），共7天
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07',
])

/**
 * 调休上班日（按北京时间日期）：官方明确要求上班的周末。
 * 这些日子即使落在周六周日，也按工作日走高峰钟点。
 */
export const WORKDAY_OVERRIDES = new Set([
  // 元旦调休：1月4日（周日）上班
  '2026-01-04',
  // 春节调休：2月14日（周六）、2月28日（周六）上班
  '2026-02-14', '2026-02-28',
  // 劳动节调休：5月9日（周六）上班
  '2026-05-09',
  // 国庆调休：9月20日（周日）、10月10日（周六）上班
  '2026-09-20', '2026-10-10',
])

/** 已收录完整法定节假日安排的年份。超出范围的年份只能按工作日/周末估算。 */
export const COVERED_YEARS = new Set([2026])

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
 *   reason: 'weekend' | 'holiday' | 'peak-window' | 'off-window' | 'makeup-workday',
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
  const isWeekend = parts.weekday >= 6
  const inPeakWindow = PEAK_WINDOWS.some(
    ([start, end]) => parts.hour >= start && parts.hour < end,
  )

  // 1. 法定节假日：整天空闲（优先于调休，正常不会重叠）
  if (HOLIDAYS.has(parts.dateKey)) {
    return { ...base, phase: 'idle', reason: 'holiday', discount: 0.5 }
  }

  // 2. 调休上班日：按工作日走钟点，工作日也可能被调成休息、周末也可能上班
  if (WORKDAY_OVERRIDES.has(parts.dateKey)) {
    return {
      ...base,
      phase: inPeakWindow ? 'peak' : 'idle',
      reason: inPeakWindow ? 'makeup-workday' : 'off-window',
      discount: inPeakWindow ? 1 : 0.5,
    }
  }

  // 3. 周末：整天空闲
  if (isWeekend) {
    return { ...base, phase: 'idle', reason: 'weekend', discount: 0.5 }
  }

  // 4. 普通工作日：按钟点判断
  return {
    ...base,
    phase: inPeakWindow ? 'peak' : 'idle',
    reason: inPeakWindow ? 'peak-window' : 'off-window',
    discount: inPeakWindow ? 1 : 0.5,
  }
}

/**
 * 距下一次时段切换还有多少毫秒。
 *
 * 按分钟向前试探，最多找 14 天（覆盖最长春节假期），
 * 因此节假日边界也能正确跨过，不依赖「只看下一个钟点」的近似。
 *
 * @param {number} [timeMs] - UTC 毫秒时间戳，默认当前时刻。
 * @returns {{ phase: 'peak' | 'idle', nextPhase: 'peak' | 'idle', nextChangeMs: number }}
 */
export function untilNextChange(timeMs = Date.now()) {
  const current = resolvePhase(timeMs)
  const step = 60 * 1000
  const horizon = 14 * 24 * 60 * 60 * 1000
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
 * 判定依据的中文说明，用于让用户知道为什么是这个结果。
 * @param {ReturnType<typeof resolvePhase>} current
 * @returns {string}
 */
export function reasonText(current) {
  switch (current.reason) {
    case 'holiday': return '法定节假日'
    case 'weekend': return '周末'
    case 'makeup-workday': return '调休上班日'
    case 'peak-window': return '工作日高峰时段'
    default: return '工作日非高峰时段'
  }
}

/**
 * 生成一句人类可读的时段摘要。
 * @param {number} [timeMs]
 * @returns {string}
 */
export function describePhase(timeMs = Date.now()) {
  const current = resolvePhase(timeMs)
  const next = untilNextChange(timeMs)
  const price = current.phase === 'peak' ? '标准价' : '半价'
  const head = `${phaseLabel(current.phase)}（${price}，${reasonText(current)}）`
  const tail = next.nextChangeMs > 0
    ? `，距${phaseLabel(next.nextPhase)}还有 ${formatDuration(next.nextChangeMs)}`
    : ''
  const caveat = current.calendarCovered
    ? ''
    : `；${current.dateKey.slice(0, 4)} 年节假日日历未收录，仅按工作日/周末估算`
  return `${head}${tail}${caveat}`
}
