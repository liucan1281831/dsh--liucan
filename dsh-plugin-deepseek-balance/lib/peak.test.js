/**
 * 峰谷时段判定的离线测试：不联网、不依赖 DSH、不依赖真实时钟。
 *
 * 每条断言都对应官方价格页上的一条规则，规则变了这里就该红。
 * 运行：node --test lib/peak.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  beijingParts,
  resolvePhase,
  untilNextChange,
  phaseLabel,
  formatDuration,
  describePhase,
  PEAK_WINDOWS,
} from './peak.js'

/**
 * 构造一个北京时间的时刻，返回 UTC 毫秒戳。
 * @param {string} local - 形如 '2026-10-19T09:30'（北京时间）。
 * @returns {number}
 */
function bj(local) {
  // 北京时间 = UTC+8，减去偏移后按 UTC 解析
  const asUtc = Date.parse(`${local}:00Z`)
  return asUtc - 8 * 60 * 60 * 1000
}

test('PEAK_WINDOWS 与官方文档一致：9-12、14-18', () => {
  assert.deepEqual(PEAK_WINDOWS, [[9, 12], [14, 18]])
})

test('beijingParts 正确拆出北京时间分量', () => {
  // 2026-10-19 是周一
  const p = beijingParts(bj('2026-10-19T09:30'))
  assert.equal(p.year, 2026)
  assert.equal(p.month, 10)
  assert.equal(p.day, 19)
  assert.equal(p.weekday, 1)
  assert.equal(p.hour, 9)
  assert.equal(p.minute, 30)
  assert.equal(p.dateKey, '2026-10-19')
})

test('beijingParts 周日映射为 7 而不是 0', () => {
  // 2026-10-18 是周日
  assert.equal(beijingParts(bj('2026-10-18T12:00')).weekday, 7)
})

test('工作日 9:00 起进入高峰，12:00 整退出', () => {
  assert.equal(resolvePhase(bj('2026-10-19T08:59')).phase, 'idle')
  assert.equal(resolvePhase(bj('2026-10-19T09:00')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T11:59')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T12:00')).phase, 'idle')
})

test('工作日午休 12:00-14:00 是空闲', () => {
  assert.equal(resolvePhase(bj('2026-10-19T12:00')).reason, 'off-window')
  assert.equal(resolvePhase(bj('2026-10-19T13:59')).phase, 'idle')
  assert.equal(resolvePhase(bj('2026-10-19T14:00')).phase, 'peak')
})

test('工作日 14:00-18:00 是高峰，18:00 整退出', () => {
  assert.equal(resolvePhase(bj('2026-10-19T14:00')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T17:59')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T18:00')).phase, 'idle')
})

test('工作日深夜与清晨是空闲', () => {
  assert.equal(resolvePhase(bj('2026-10-19T00:30')).phase, 'idle')
  assert.equal(resolvePhase(bj('2026-10-19T06:00')).phase, 'idle')
  assert.equal(resolvePhase(bj('2026-10-19T23:59')).phase, 'idle')
})

test('周末全天空闲，即便落在高峰钟点内', () => {
  // 2026-10-17 周六、2026-10-18 周日
  for (const local of [
    '2026-10-17T10:00',
    '2026-10-17T15:00',
    '2026-10-18T10:00',
    '2026-10-18T15:00',
  ]) {
    const r = resolvePhase(bj(local))
    assert.equal(r.phase, 'idle', local)
    assert.equal(r.reason, 'weekend', local)
  }
})

test('空闲时段折扣为半价，高峰为标准价', () => {
  assert.equal(resolvePhase(bj('2026-10-19T10:00')).discount, 1)
  assert.equal(resolvePhase(bj('2026-10-19T12:30')).discount, 0.5)
  assert.equal(resolvePhase(bj('2026-10-17T10:00')).discount, 0.5)
})

test('未覆盖日历的年份明确标注 calendarCovered=false', () => {
  const r = resolvePhase(bj('2026-10-19T10:00'))
  assert.equal(r.calendarCovered, false)
  assert.match(describePhase(bj('2026-10-19T10:00')), /未覆盖/)
})

test('untilNextChange 从午休推算出下一个高峰', () => {
  const r = untilNextChange(bj('2026-10-19T12:30'))
  assert.equal(r.phase, 'idle')
  assert.equal(r.nextPhase, 'peak')
  // 12:30 → 14:00 是 90 分钟
  assert.equal(r.nextChangeMs, 90 * 60 * 1000)
})

test('untilNextChange 从高峰推算出下一个空闲', () => {
  const r = untilNextChange(bj('2026-10-19T10:00'))
  assert.equal(r.phase, 'peak')
  assert.equal(r.nextPhase, 'idle')
  // 10:00 → 12:00 是 120 分钟
  assert.equal(r.nextChangeMs, 120 * 60 * 1000)
})

test('untilNextChange 周五晚推算出周末（持续空闲）', () => {
  const r = untilNextChange(bj('2026-10-16T19:00'))
  assert.equal(r.phase, 'idle')
  assert.equal(r.nextPhase, 'peak')
})

test('phaseLabel 与 formatDuration', () => {
  assert.equal(phaseLabel('peak'), '高峰时段')
  assert.equal(phaseLabel('idle'), '空闲时段')
  assert.equal(formatDuration(90 * 60 * 1000), '1小时30分')
  assert.equal(formatDuration(60 * 60 * 1000), '1小时')
  assert.equal(formatDuration(30 * 60 * 1000), '30分')
})

test('describePhase 给出可读摘要', () => {
  const text = describePhase(bj('2026-10-19T10:00'))
  assert.match(text, /高峰时段/)
  assert.match(text, /标准价/)
  assert.match(text, /空闲时段/)
})
