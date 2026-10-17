/**
 * 快照落盘的离线测试：用系统临时目录，不碰真实数据。
 *
 * 运行：node --test lib/usage-store.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadUsage, saveUsage } from './usage-store.js'
import { emptyUsageState } from './usage.js'

/** 建一个临时目录并确保清理。 */
async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-balance-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('文件不存在时返回空状态且视为可用', async () => {
  await withTempDir(async dir => {
    const result = await loadUsage(join(dir, 'missing.json'))
    assert.equal(result.available, true)
    assert.deepEqual(result.state, emptyUsageState())
  })
})

test('写入后可原样读回', async () => {
  await withTempDir(async dir => {
    const file = join(dir, 'nested', 'usage.json')
    const state = { snapshots: [{ dateKey: '2026-10-18', timeMs: 1, total: 52.98, currency: 'CNY' }] }
    const saved = await saveUsage(file, state)
    assert.equal(saved.available, true)

    const loaded = await loadUsage(file)
    assert.equal(loaded.available, true)
    assert.deepEqual(loaded.state, state)
  })
})

test('写入会创建缺失的父目录', async () => {
  await withTempDir(async dir => {
    const file = join(dir, 'a', 'b', 'c', 'usage.json')
    await saveUsage(file, emptyUsageState())
    const text = await readFile(file, 'utf8')
    assert.match(text, /snapshots/)
  })
})

test('损坏的 JSON 不抛错，降级为不可用', async () => {
  await withTempDir(async dir => {
    const file = join(dir, 'usage.json')
    await writeFile(file, '{ not json', 'utf8')
    const result = await loadUsage(file)
    assert.equal(result.available, false)
    assert.ok(result.error)
    assert.deepEqual(result.state, emptyUsageState())
  })
})

test('结构不对的 JSON 也降级为空状态', async () => {
  await withTempDir(async dir => {
    const file = join(dir, 'usage.json')
    await writeFile(file, '{"foo":1}', 'utf8')
    const result = await loadUsage(file)
    assert.equal(result.available, true)
    assert.deepEqual(result.state, emptyUsageState())
  })
})

test('保存不会残留临时文件', async () => {
  await withTempDir(async dir => {
    const file = join(dir, 'usage.json')
    await saveUsage(file, emptyUsageState())
    const { readdir } = await import('node:fs/promises')
    const names = await readdir(dir)
    assert.deepEqual(names, ['usage.json'])
  })
})
