/**
 * 今日消耗追踪的离线测试：不联网、不依赖 DSH、不碰文件系统。
 *
 * 运行：node --test lib/usage.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  emptyUsageState,
  parseAmount,
  appendSnapshot,
  computeDailyUsage,
  formatDailyUsage,
  round2,
} from './usage.js'

/** 构造一笔余额快照条目。 */
function entry(dateKey, total, timeMs = Date.parse(`${dateKey}T01:00:00Z`)) {
  return { dateKey, timeMs, balances: [{ currency: 'CNY', total: String(total) }] }
}

test('parseAmount 处理合法与脏数据', () => {
  assert.equal(parseAmount('52.98'), 52.98)
  assert.equal(parseAmount('0'), 0)
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount('abc'), null)
  assert.equal(parseAmount(undefined), null)
})

test('round2 消除浮点误差', () => {
  assert.equal(round2(0.1 + 0.2), 0.3)
  assert.equal(round2(52.98 - 51.96), 1.02)
})

test('同日首笔快照成为基准，第二笔得出消耗', () => {
  let state = emptyUsageState()
  state = appendSnapshot(state, entry('2026-10-18', 52.98, 1000))
  const first = computeDailyUsage(state, '2026-10-18')
  assert.equal(first.status, 'no-baseline')
  assert.equal(first.used, 0)
  assert.equal(first.baseline, 52.98)

  state = appendSnapshot(state, entry('2026-10-18', 51.96, 2000))
  const second = computeDailyUsage(state, '2026-10-18')
  assert.equal(second.status, 'ok')
  assert.equal(second.used, 1.02)
  assert.equal(second.baseline, 52.98)
  assert.equal(second.latest, 51.96)
})

test('同一天只保留首笔与最新一笔，不会无限增长', () => {
  let state = emptyUsageState()
  for (const [i, total] of [60, 59, 58, 57].entries()) {
    state = appendSnapshot(state, entry('2026-10-18', total, 1000 + i))
  }
  assert.equal(state.snapshots.length, 2)
  assert.equal(state.snapshots[0].total, 60)
  assert.equal(state.snapshots[1].total, 57)
})

test('跨天重置基准', () => {
  let state = emptyUsageState()
  state = appendSnapshot(state, entry('2026-10-17', 60, 1000))
  state = appendSnapshot(state, entry('2026-10-17', 58, 2000))
  state = appendSnapshot(state, entry('2026-10-18', 58, 3000))

  const yesterday = computeDailyUsage(state, '2026-10-17')
  assert.equal(yesterday.used, 2)

  // 今天只有一笔，量应该是 0，不应沿用昨天的基准
  const today = computeDailyUsage(state, '2026-10-18')
  assert.equal(today.status, 'no-baseline')
  assert.equal(today.used, 0)
  assert.equal(today.baseline, 58)
})

test('充值导致余额上升时明确标记，不报负数', () => {
  let state = emptyUsageState()
  state = appendSnapshot(state, entry('2026-10-18', 10, 1000))
  state = appendSnapshot(state, entry('2026-10-18', 60, 2000))
  const usage = computeDailyUsage(state, '2026-10-18')
  assert.equal(usage.recharge, true)
  assert.equal(usage.used, null)
  assert.equal(usage.status, 'insufficient-data')
  assert.match(formatDailyUsage(usage), /充值/)
})

test('传入实时余额时以它作为 latest', () => {
  let state = emptyUsageState()
  state = appendSnapshot(state, entry('2026-10-18', 52.98, 1000))
  state = appendSnapshot(state, entry('2026-10-18', 52.5, 2000))
  const usage = computeDailyUsage(state, '2026-10-18', 51.96, 'CNY')
  assert.equal(usage.used, 1.02)
  assert.equal(usage.latest, 51.96)
})

test('没有任何记录时返回 no-snapshot', () => {
  const usage = computeDailyUsage(emptyUsageState(), '2026-10-18')
  assert.equal(usage.status, 'no-snapshot')
  assert.equal(usage.used, null)
  assert.match(formatDailyUsage(usage), /暂无记录/)
})

test('脏快照被忽略而不抛错', () => {
  let state = appendSnapshot(emptyUsageState(), entry('2026-10-18', 'not-a-number'))
  assert.equal(state.snapshots.length, 0)
})

test('只保留最近若干天，防止文件无限增长', () => {
  let state = emptyUsageState()
  for (let i = 0; i < 40; i += 1) {
    const day = String(i + 1).padStart(2, '0')
    state = appendSnapshot(state, entry(`2026-10-${day}`, 100 - i, 1000 + i))
  }
  assert.ok(state.snapshots.length <= 60)
})

test('formatDailyUsage 输出两位小数', () => {
  let state = emptyUsageState()
  state = appendSnapshot(state, entry('2026-10-18', 52.98, 1000))
  state = appendSnapshot(state, entry('2026-10-18', 51.96, 2000))
  assert.equal(
    formatDailyUsage(computeDailyUsage(state, '2026-10-18')),
    '今日已用：1.02 CNY',
  )
})
