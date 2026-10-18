import test from 'node:test'
import assert from 'node:assert/strict'

import {
  autoSourceName,
  DEFAULT_HARVEST_AT,
  DEFAULT_HARVEST_KEYWORDS,
  formatElapsed,
  isHarvestDue,
  localDayKey,
  minutesOfDay,
  normalizeHarvestAt,
  normalizeKeywords,
  parseKeywords,
  pickAutoSources,
  summarizeReport,
} from './harvest.js'
import { normalizeSettings, SETTINGS_DEFAULTS } from './pet-settings.js'

/** 构造一个本地时间的日期，便于跨天断言。 */
function localDate(y, m, d, hh = 12, mm = 0) {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

test('normalizeHarvestAt：只接受 HH:mm，非法回退默认', () => {
  assert.equal(normalizeHarvestAt('09:30'), '09:30')
  assert.equal(normalizeHarvestAt('9:05'), '09:05')
  assert.equal(normalizeHarvestAt('23:59'), '23:59')
  assert.equal(normalizeHarvestAt('24:00'), DEFAULT_HARVEST_AT)
  assert.equal(normalizeHarvestAt('9点'), DEFAULT_HARVEST_AT)
  assert.equal(normalizeHarvestAt(''), DEFAULT_HARVEST_AT)
  assert.equal(normalizeHarvestAt(null), DEFAULT_HARVEST_AT)
})

test('minutesOfDay：换算成当天第几分钟', () => {
  assert.equal(minutesOfDay('00:00'), 0)
  assert.equal(minutesOfDay('10:00'), 600)
  assert.equal(minutesOfDay('23:59'), 1439)
})

test('localDayKey：本地日期键', () => {
  assert.equal(localDayKey(localDate(2026, 10, 18)), '2026-10-18')
  assert.equal(localDayKey(localDate(2026, 1, 5)), '2026-01-05')
})

test('isHarvestDue：10:00 之后首次运行，当天跑过就不再跑', () => {
  const at = '10:00'
  const before = localDate(2026, 10, 18, 9, 59)
  const after = localDate(2026, 10, 18, 10, 0)
  assert.equal(isHarvestDue({ now: before, lastRunDay: '', at }), false)
  assert.equal(isHarvestDue({ now: after, lastRunDay: '', at }), true)
  assert.equal(isHarvestDue({ now: after, lastRunDay: '2026-10-18', at }), false)
  // 昨天跑过、今天 10 点后：补跑
  assert.equal(isHarvestDue({ now: after, lastRunDay: '2026-10-17', at }), true)
  // 自定义时刻
  assert.equal(isHarvestDue({ now: after, lastRunDay: '', at: '23:00' }), false)
})

test('parseKeywords：逗号/换行切分、去控制字符、限量', () => {
  assert.deepEqual(parseKeywords('a, b，c\nd'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(parseKeywords('  ,,  '), [])
  assert.deepEqual(parseKeywords(null), [])
  const many = parseKeywords(Array.from({ length: 20 }, (_, i) => `k${i}`).join(','))
  assert.equal(many.length, 8)
  assert.deepEqual(parseKeywords('x'.repeat(100)), ['x'.repeat(24)])
  assert.deepEqual(parseKeywords('a\u0000b'), ['ab'])
})

test('normalizeKeywords：空输入回退默认关键词', () => {
  assert.equal(normalizeKeywords(''), DEFAULT_HARVEST_KEYWORDS)
  assert.equal(normalizeKeywords('  ,  '), DEFAULT_HARVEST_KEYWORDS)
  assert.equal(normalizeKeywords('大肥鱼 唱歌, 大肥鱼 音频'), '大肥鱼 唱歌, 大肥鱼 音频')
})

test('summarizeReport：成功/空结果/失败三种文案', () => {
  const ok = summarizeReport({
    ok: true,
    elapsedSec: 183,
    threshold: 0.65,
    stats: { queued: 44, videosTried: 20, segments: 66, stoppedBy: 'budget' },
    candidates: [{ sim: 0.9 }, { sim: 0.8 }],
  })
  assert.equal(ok.level, 'ok')
  assert.equal(ok.accepted, 2)
  assert.match(ok.text, /2 段/)
  assert.match(ok.detail, /3 分 3 秒/)
  assert.match(ok.detail, /到预算/)

  const empty = summarizeReport({
    ok: true, elapsedSec: 20, threshold: 0.7,
    stats: { queued: 5, videosTried: 5, segments: 9 }, candidates: [],
  })
  assert.equal(empty.level, 'warn')
  assert.equal(empty.accepted, 0)

  const failed = summarizeReport({ ok: false, code: 'NO_ANCHOR', message: '没有基准' })
  assert.equal(failed.level, 'error')
  assert.equal(failed.detail, '没有基准')
})

test('pickAutoSources：按阈值过滤、按相似度排序、限制数量', () => {
  const list = [
    { wav: 'a.wav', sim: 0.7 },
    { wav: 'b.wav', sim: 0.9 },
    { wav: 'c.wav', sim: 0.5 },
    { wav: 'd.wav', sim: 0.8 },
    { sim: 0.99 },
    { wav: 'e.wav' },
  ]
  const picked = pickAutoSources(list, { minSim: 0.65, max: 2 })
  assert.deepEqual(picked.map(c => c.wav), ['b.wav', 'd.wav'])
  // max 夹取到 1..5
  assert.equal(pickAutoSources(list, { minSim: 0.6, max: 99 }).length, 3)
  assert.equal(pickAutoSources(list, { minSim: 0.6, max: 0 }).length, 1)
  assert.deepEqual(pickAutoSources(null), [])
})

test('autoSourceName：带日期、相似度与标题，且不超长', () => {
  const name = autoSourceName({ sim: 0.873, title: '示例视频标题' }, '2026-10-18', 1)
  assert.match(name, /2026-10-18/)
  assert.match(name, /87%/)
  assert.match(name, /#1/)
  assert.ok(name.length <= 60)
  assert.match(autoSourceName({}, '2026-10-18', 2), /相似度未知/)
})

test('formatElapsed：秒 / 分 的读法', () => {
  assert.equal(formatElapsed(0), '0 秒')
  assert.equal(formatElapsed(45), '45 秒')
  assert.equal(formatElapsed(180), '3 分')
  assert.equal(formatElapsed(183), '3 分 3 秒')
  assert.equal(formatElapsed('x'), '0 秒')
})

test('normalizeSettings：新字段的默认值与夹取', () => {
  const d = normalizeSettings({})
  assert.equal(d.petEnabled, true)
  assert.equal(d.harvestEnabled, true)
  assert.equal(d.harvestAt, '10:00')
  assert.equal(d.harvestKeywords, DEFAULT_HARVEST_KEYWORDS)
  assert.equal(d.harvestBudgetMin, 20)
  assert.equal(d.harvestMinSim, 0.65)
  assert.equal(d.harvestAutoAdd, true)
  assert.equal(d.harvestAnchor, '')

  const off = normalizeSettings({ petEnabled: false, harvestEnabled: false, harvestAutoAdd: false })
  assert.equal(off.petEnabled, false)
  assert.equal(off.harvestEnabled, false)
  assert.equal(off.harvestAutoAdd, false)

  const clamped = normalizeSettings({
    harvestAt: '99:99', harvestBudgetMin: 999, harvestMinSim: -3, harvestAnchor: 'BV1xx\n',
  })
  assert.equal(clamped.harvestAt, '10:00')
  assert.equal(clamped.harvestBudgetMin, 60)
  assert.equal(clamped.harvestMinSim, 0.4)
  assert.equal(clamped.harvestAnchor, 'BV1xx')

  // 旧设置文件（没有这些字段）不应被误判成关闭
  assert.equal(normalizeSettings({ size: 100 }).petEnabled, true)
  // 默认值对象本身保持干净
  assert.equal(SETTINGS_DEFAULTS.harvestEnabled, true)
})
