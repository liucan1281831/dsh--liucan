/**
 * 上游动画池（lib/anim-catalog.js）离线测试。
 *
 * 这里守的是「和上游一致」的两件事：
 *  1. 池子里的动画名就是上游 106 个 webm 的文件名；
 *  2. 分类权重拼起来正好是 100（idle 10 + turn 5 + move 5 + 分类 80），
 *     否则随机动作的出现频率会和视频里不一样。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ANIMATION_EXT,
  ANIMATION_MATTE_BASE_PATH,
  ANIMATION_POOLS,
  ANIMATION_WEIGHTS,
  EXPECTED_CLIP_COUNT,
  buildAnimationManifest,
  collectClipNames,
  normalizeClipName,
  selectAvailablePools,
} from './anim-catalog.js'

test('扩展名与清单格式固定', () => {
  assert.equal(ANIMATION_EXT, '.webm')
})

test('上游引用的动画共 106 个，名字不重复', () => {
  const names = collectClipNames()
  assert.equal(names.length, EXPECTED_CLIP_COUNT)
  assert.equal(new Set(names).size, names.length)
  assert.equal(EXPECTED_CLIP_COUNT, 106)
})

test('分类权重合计 80，与顶层权重拼成 100', () => {
  const random = ANIMATION_POOLS.categories.reduce((sum, c) => sum + c.weight, 0)
  assert.equal(random, 80)
  const total = ANIMATION_WEIGHTS.idle + ANIMATION_WEIGHTS.turn + ANIMATION_WEIGHTS.move + random
  assert.equal(total, 100)
})

test('素材齐全时清单完整、不缺任何动画', () => {
  const manifest = buildAnimationManifest(collectClipNames())
  assert.equal(manifest.ok, true)
  assert.equal(manifest.available, true)
  assert.equal(manifest.count, 106)
  assert.deepEqual(manifest.missing, [])
  assert.equal(manifest.weights.total, 100)
  assert.equal(manifest.pools.idle.length, 1)
  assert.equal(manifest.pools.clicks.length, 5)
  assert.equal(manifest.pools.categories.length, 5)
  assert.equal(manifest.pools.events.balance.length, 6)
})

test('缺素材时从池里摘掉并列出 missing，空分类整类移除', () => {
  const all = collectClipNames()
  // 只留 idle + 一个「文字」分类的动画
  const keep = new Set(['待机呼吸休闲', '是啊，吃什么', '深度思考碎碎念'])
  const available = all.filter(name => keep.has(name))
  const manifest = buildAnimationManifest(available)
  assert.equal(manifest.ok, true)
  assert.equal(manifest.count, 3)
  assert.equal(manifest.missing.length, all.length - 3)
  assert.equal(manifest.pools.categories.length, 1)
  assert.equal(manifest.pools.categories[0].id, '文字')
  assert.equal(manifest.pools.clicks.length, 0)
  assert.equal(manifest.pools.drag.length, 0)
})

test('一份素材都没有时返回 NO_ASSETS（前端据此回退图片）', () => {
  const manifest = buildAnimationManifest([])
  assert.equal(manifest.ok, false)
  assert.equal(manifest.available, false)
  assert.equal(manifest.reason, 'NO_ASSETS')
  assert.equal(manifest.missing.length, 106)
  assert.equal(manifest.pools, null)
})

test('selectAvailablePools 不修改传入池子（纯函数）', () => {
  const before = JSON.stringify(ANIMATION_POOLS)
  selectAvailablePools(['待机呼吸休闲'])
  assert.equal(JSON.stringify(ANIMATION_POOLS), before)
})

test('白底版本齐全时 manifest.matte.complete = true（安卓 WebView 回退用）', () => {
  const all = collectClipNames()
  const manifest = buildAnimationManifest(all, { matteNames: all })
  assert.equal(manifest.matte.available, true)
  assert.equal(manifest.matte.count, 106)
  assert.equal(manifest.matte.complete, true)
  assert.equal(manifest.matte.basePath, ANIMATION_MATTE_BASE_PATH)
})

test('白底版本不全 / 不存在时不标记 complete', () => {
  const all = collectClipNames()
  const partial = buildAnimationManifest(all, { matteNames: all.slice(0, 60) })
  assert.equal(partial.matte.available, true)
  assert.equal(partial.matte.complete, false)

  const none = buildAnimationManifest(all)
  assert.equal(none.matte.available, false)
  assert.equal(none.matte.count, 0)
  assert.equal(none.matte.complete, false)
})

test('动画名规范化：放行中文/空格/标点，挡住路径与控制字符', () => {
  assert.equal(normalizeClipName('  待机呼吸休闲  '), '待机呼吸休闲')
  assert.equal(normalizeClipName('点击回应-开心跃动'), '点击回应-开心跃动')
  assert.equal(normalizeClipName('是啊，吃什么'), '是啊，吃什么')
  assert.equal(normalizeClipName('原地漂浮踏步'), '原地漂浮踏步')

  for (const bad of [
    '', '   ', '../etc/passwd', 'a/b', 'a\\b', '..', '.hidden',
    'a\u0000b', 'a\nb', null, undefined, 42, 'x'.repeat(130),
  ]) {
    assert.equal(normalizeClipName(bad), '', `应拒绝 ${JSON.stringify(bad)}`)
  }
})
