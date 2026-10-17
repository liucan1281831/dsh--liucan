/**
 * 峰谷时段判定的离线测试：不联网、不依赖 DSH、不依赖真实时钟。
 *
 * 每条断言都对应一条可核对的规则：
 *   - 钟点规则 ← 官方价格页
 *   - 节假日 / 调休 ← 国办发明电〔2025〕7号
 * 规则变了这里就该红。
 *
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
  reasonText,
  PEAK_WINDOWS,
  HOLIDAYS,
  WORKDAY_OVERRIDES,
  COVERED_YEARS,
} from './peak.js'

/**
 * 构造一个北京时间的时刻，返回 UTC 毫秒戳。
 * @param {string} local - 形如 '2026-10-19T09:30'（北京时间）。
 * @returns {number}
 */
function bj(local) {
  const asUtc = Date.parse(`${local}:00Z`)
  return asUtc - 8 * 60 * 60 * 1000
}

test('PEAK_WINDOWS 与官方文档一致：9-12、14-18', () => {
  assert.deepEqual(PEAK_WINDOWS, [[9, 12], [14, 18]])
})

test('beijingParts 正确拆出北京时间分量', () => {
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
  assert.equal(beijingParts(bj('2026-10-18T12:00')).weekday, 7)
})

// ── 钟点规则 ───────────────────────────────────────────────

test('工作日 9:00 起进入高峰，12:00 整退出', () => {
  assert.equal(resolvePhase(bj('2026-10-19T08:59')).phase, 'idle')
  assert.equal(resolvePhase(bj('2026-10-19T09:00')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T11:59')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T12:00')).phase, 'idle')
})

test('工作日午休 12:00-14:00 是空闲', () => {
  assert.equal(resolvePhase(bj('2026-10-19T12:00')).reason, 'off-window')
  assert.equal(resolvePhase(bj('2026-10-19T14:00')).phase, 'peak')
})

test('工作日 14:00-18:00 是高峰，18:00 整退出', () => {
  assert.equal(resolvePhase(bj('2026-10-19T14:00')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T17:59')).phase, 'peak')
  assert.equal(resolvePhase(bj('2026-10-19T18:00')).phase, 'idle')
})

test('普通周末全天空闲', () => {
  // 2026-10-17 周六、2026-10-18 周日，均非调休上班日
  for (const local of ['2026-10-17T10:00', '2026-10-18T15:00']) {
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

// ── 法定节假日（国办发明电〔2025〕7号）────────────────────

test('国庆假期 10/1-10/7 全天空闲，含落在工作日的 10/5-10/7', () => {
  for (const day of ['01', '02', '03', '04', '05', '06', '07']) {
    const r = resolvePhase(bj(`2026-10-${day}T10:00`))
    assert.equal(r.phase, 'idle', `10/${day}`)
    assert.equal(r.reason, 'holiday', `10/${day}`)
  }
})

test('春节长假如 2/23（周一）在高峰钟点也判为空闲', () => {
  // 2/23 是农历正月初七，周一，正常该是高峰
  assert.equal(beijingParts(bj('2026-02-23T10:00')).weekday, 1)
  const r = resolvePhase(bj('2026-02-23T10:00'))
  assert.equal(r.phase, 'idle')
  assert.equal(r.reason, 'holiday')
})

test('元旦 1/1-1/3 空闲', () => {
  for (const day of ['01', '02', '03']) {
    assert.equal(resolvePhase(bj(`2026-01-${day}T15:00`)).reason, 'holiday', day)
  }
})

test('清明 4/4-4/6、劳动节 5/1-5/5、端午 6/19-6/21、中秋 9/25-9/27 都空闲', () => {
  const checks = [
    ['2026-04-04', '2026-04-05', '2026-04-06'],
    ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'],
    ['2026-06-19', '2026-06-20', '2026-06-21'],
    ['2026-09-25', '2026-09-26', '2026-09-27'],
  ]
  for (const group of checks) {
    for (const date of group) {
      assert.equal(resolvePhase(bj(`${date}T10:00`)).reason, 'holiday', date)
    }
  }
})

// ── 调休上班日 ─────────────────────────────────────────────

test('调休上班的周末按工作日走：1/4（周日）上午是高峰', () => {
  assert.equal(beijingParts(bj('2026-01-04T10:00')).weekday, 7)
  const r = resolvePhase(bj('2026-01-04T10:00'))
  assert.equal(r.phase, 'peak')
  assert.equal(r.reason, 'makeup-workday')
  // 但午休仍空闲
  assert.equal(resolvePhase(bj('2026-01-04T13:00')).phase, 'idle')
})

test('6 个调休上班日在高峰钟点全部判为高峰', () => {
  const overrides = [
    '2026-01-04', '2026-02-14', '2026-02-28',
    '2026-05-09', '2026-09-20', '2026-10-10',
  ]
  for (const date of overrides) {
    const r = resolvePhase(bj(`${date}T10:00`))
    assert.equal(r.phase, 'peak', date)
    assert.equal(r.reason, 'makeup-workday', date)
  }
})

test('调休上班日 10/10（周六）下午仍是高峰', () => {
  const r = resolvePhase(bj('2026-10-10T15:00'))
  assert.equal(r.phase, 'peak')
  assert.equal(r.reason, 'makeup-workday')
})

// ── 日历完整性 ─────────────────────────────────────────────

test('2026 年节假日共 33 天，调休上班日 6 天', () => {
  assert.equal(HOLIDAYS.size, 33)
  assert.equal(WORKDAY_OVERRIDES.size, 6)
  assert.ok(COVERED_YEARS.has(2026))
})

test('节假日与调休上班日不重叠', () => {
  for (const date of HOLIDAYS) {
    assert.equal(WORKDAY_OVERRIDES.has(date), false, date)
  }
})

test('2027 年明确标注日历未覆盖', () => {
  const r = resolvePhase(bj('2027-03-10T10:00'))
  assert.equal(r.calendarCovered, false)
  assert.match(describePhase(bj('2027-03-10T10:00')), /未收录/)
})

test('2026 年不再出现「未覆盖」提示', () => {
  assert.doesNotMatch(describePhase(bj('2026-10-19T10:00')), /未收录/)
})

// ── 倒计时 ─────────────────────────────────────────────────

test('untilNextChange 从午休推算出下一个高峰', () => {
  const r = untilNextChange(bj('2026-10-19T12:30'))
  assert.equal(r.phase, 'idle')
  assert.equal(r.nextPhase, 'peak')
  assert.equal(r.nextChangeMs, 90 * 60 * 1000)
})

test('untilNextChange 从高峰推算出下一个空闲', () => {
  const r = untilNextChange(bj('2026-10-19T10:00'))
  assert.equal(r.phase, 'peak')
  assert.equal(r.nextPhase, 'idle')
  assert.equal(r.nextChangeMs, 120 * 60 * 1000)
})

test('untilNextChange 跨春节：2/14 为调休上班日，下一高峰在次日 09:00', () => {
  const r = untilNextChange(bj('2026-02-13T19:00'))
  assert.equal(r.phase, 'idle')
  assert.equal(r.nextPhase, 'peak')
  // 2/14（周六）是春节调休上班日，按工作日走高峰钟点：19:00 → 次日 09:00，共 14 小时。
  // 若将来撤销该调休，应改回「持续到 2/24 09:00，共 10 天 14 小时」。
  assert.equal(r.nextChangeMs, 14 * 60 * 60 * 1000)
})

test('春节假期内（2/16）整天不计高峰', () => {
  for (const hour of [9, 10, 14, 17]) {
    const hh = String(hour).padStart(2, '0')
    const p = resolvePhase(bj('2026-02-16T' + hh + ':00'))
    assert.equal(p.phase, 'idle', '2/16 ' + hh + ':00 应为空闲')
    assert.equal(p.reason, 'holiday')
  }
})

// ── 展示层 ─────────────────────────────────────────────────

test('phaseLabel / formatDuration / reasonText', () => {
  assert.equal(phaseLabel('peak'), '高峰时段')
  assert.equal(phaseLabel('idle'), '空闲时段')
  assert.equal(formatDuration(90 * 60 * 1000), '1小时30分')
  assert.equal(formatDuration(60 * 60 * 1000), '1小时')
  assert.equal(formatDuration(30 * 60 * 1000), '30分')
  assert.equal(reasonText({ reason: 'holiday' }), '法定节假日')
  assert.equal(reasonText({ reason: 'makeup-workday' }), '调休上班日')
})

test('describePhase 给出可读摘要并说明依据', () => {
  const text = describePhase(bj('2026-10-19T10:00'))
  assert.match(text, /高峰时段/)
  assert.match(text, /标准价/)
  assert.match(text, /工作日高峰时段/)
})

test('describePhase 在节假日说明「法定节假日」', () => {
  assert.match(describePhase(bj('2026-10-01T10:00')), /法定节假日/)
})
