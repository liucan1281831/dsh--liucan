/**
 * 纯逻辑：今日消耗追踪。
 *
 * DeepSeek 余额接口只给当前余额，没有历史消耗。要算「今天用了多少」，
 * 只能在每次查询时记一笔快照，再用「当日首个快照余额 − 当前余额」得出。
 *
 * 关键约束：
 * - 只有「今天第一个快照」能作为基准。之后快照只用于覆盖当天余额。
 * - 账户充值会让余额上升，此时用余额差算消耗会得出负数 → 明确标记 recharge，
 *   而不是报一个负的「消耗」。
 * - 跨天（北京时间 0 点）自然重置：基准换成新一天的第一个快照。
 *
 * 与 cordis、文件系统完全解耦，只处理数据结构与算术，便于离线单测。
 *
 * @module dsh-plugin-deepseek-balance/lib/usage
 */

/**
 * 「今日已用」的可用性状态。
 * @typedef {'ok' | 'no-baseline' | 'no-snapshot' | 'insufficient-data'} UsageStatus
 */

/**
 * 新建一份空的追踪状态。
 * @returns {{ snapshots: Array<{ dateKey: string, timeMs: number, total: number, currency: string }> }}
 */
export function emptyUsageState() {
  return { snapshots: [] }
}

/**
 * 从余额字符串里取数值；取不到返回 null。
 * @param {string} text
 * @returns {number | null}
 */
export function parseAmount(text) {
  const value = Number.parseFloat(String(text ?? ''))
  return Number.isFinite(value) ? value : null
}

/**
 * 追加一笔快照。同一天只保留最新一笔与当天基准，避免无限增长。
 *
 * @param {{ snapshots: Array<object> }} state - 追踪状态（不修改原对象）。
 * @param {{ dateKey: string, timeMs: number, balances: Array<{ currency: string, total: string }> }} entry
 * @returns {{ snapshots: Array<object> }}
 */
export function appendSnapshot(state, entry) {
  const currency = entry.balances[0]?.currency ?? 'CNY'
  const total = parseAmount(entry.balances[0]?.total)
  if (total === null) return state

  const snapshot = {
    dateKey: entry.dateKey,
    timeMs: entry.timeMs,
    total,
    currency,
  }
  const previous = Array.isArray(state?.snapshots) ? state.snapshots : []
  // 当天已有记录：保留首个作为基准，其余只留最新一笔
  const sameDay = previous.filter(s => s.dateKey === entry.dateKey)
  const otherDays = previous.filter(s => s.dateKey !== entry.dateKey)

  let today
  if (sameDay.length === 0) {
    today = [snapshot]
  } else {
    today = [sameDay[0], snapshot]
  }
  // 只保留最近 30 天，防止文件无限增长
  const kept = [...otherDays, ...today]
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(-60)
  return { snapshots: kept }
}

/**
 * 计算某一天的用量。
 *
 * @param {{ snapshots: Array<object> }} state - 追踪状态。
 * @param {string} dateKey - 目标日期，形如 2026-10-18。
 * @param {number} [currentTotal] - 当前最新余额（若已知，则用它代替当天最后一笔快照）。
 * @param {string} [currentCurrency] - 当前余额币种。
 * @returns {{
 *   status: UsageStatus,
 *   dateKey: string,
 *   currency: string,
 *   used: number | null,
 *   baseline: number | null,
 *   latest: number | null,
 *   baselineAt: number | null,
 *   latestAt: number | null,
 *   recharge: boolean,
 * }}
 */
export function computeDailyUsage(state, dateKey, currentTotal, currentCurrency) {
  const snapshots = Array.isArray(state?.snapshots) ? state.snapshots : []
  const sameDay = snapshots
    .filter(s => s.dateKey === dateKey)
    .sort((a, b) => a.timeMs - b.timeMs)
  const currency = currentCurrency ?? sameDay[0]?.currency ?? 'CNY'

  // 合并「当天最后一笔快照」与「当前实时余额」，取时间更晚者作为 latest
  const lastSnapshot = sameDay[sameDay.length - 1]
  const latest = currentTotal !== undefined && currentTotal !== null
    ? { total: currentTotal, timeMs: Number.MAX_SAFE_INTEGER }
    : lastSnapshot

  const base = sameDay[0] ?? null

  if (base === null && latest === undefined) {
    return {
      status: 'no-snapshot',
      dateKey,
      currency,
      used: null,
      baseline: null,
      latest: null,
      baselineAt: null,
      latestAt: null,
      recharge: false,
    }
  }

  // 今天只有一个数据点（刚记录的第一笔）：无法算出消耗，只能记为基准。
  //
  // 为什么不能用 base 是否为 null 来判断：调用方会先把当前余额 append 成快照
  // 再调用本函数，此时 sameDay 里已经有这一笔，base 永远不为 null，于是会
  // 走到下面的差值分支、得出 used = 0，让人误以为「今天一分钱没花」。
  // 用「数据点个数」判断才准确，也与 formatDailyUsage 的 no-baseline 文案对应。
  if (sameDay.length <= 1) {
    const value = latest?.total ?? base?.total ?? null
    const at = lastSnapshot?.timeMs ?? null
    return {
      status: 'no-baseline',
      dateKey,
      currency,
      used: 0,
      baseline: value,
      latest: value,
      baselineAt: at,
      latestAt: at,
      recharge: false,
    }
  }

  const baselineValue = base.total
  const latestValue = latest.total
  const delta = baselineValue - latestValue
  const recharge = delta < 0

  return {
    status: recharge ? 'insufficient-data' : 'ok',
    dateKey,
    currency,
    used: recharge ? null : round2(delta),
    baseline: baselineValue,
    latest: latestValue,
    baselineAt: base.timeMs,
    latestAt: latest.timeMs === Number.MAX_SAFE_INTEGER ? null : latest.timeMs,
    recharge,
  }
}

/**
 * 保留两位小数，去掉浮点误差。
 * @param {number} value
 * @returns {number}
 */
export function round2(value) {
  return Math.round(value * 100) / 100
}

/**
 * 把用量结果渲染成一句中文。
 * @param {ReturnType<typeof computeDailyUsage>} usage
 * @returns {string}
 */
export function formatDailyUsage(usage) {
  switch (usage.status) {
    case 'no-snapshot':
      return '今日已用：暂无记录（本次查询已开始记录基准）'
    case 'no-baseline':
      return `今日已用：0.00 ${usage.currency}（本次为今日首个基准）`
    case 'insufficient-data':
      return `今日已用：无法计算，余额从 ${usage.baseline} 升到 ${usage.latest}，期间发生过充值`
    default:
      return `今日已用：${usage.used.toFixed(2)} ${usage.currency}`
  }
}
