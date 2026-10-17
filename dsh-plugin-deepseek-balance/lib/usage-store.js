/**
 * 今日消耗追踪的落盘层：把快照写进一个 JSON 文件。
 *
 * 设计取舍：
 * - 用普通 JSON 文件而不是 storageDomain：后者要声明 domain、处理 open/close 生命周期，
 *   且在当前 profile 里不一定可用；文件方案零依赖、失效时可明确降级。
 * - 任何一次读写失败都不抛错，只把状态标记为 unavailable，
 *   让余额查询本身仍然能用（余额是主功能，今日消耗是附加信息）。
 * - 写入采用「先写临时文件再 rename」，避免进程在写一半时崩溃留下半截 JSON。
 *
 * @module dsh-plugin-deepseek-balance/lib/usage-store
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { emptyUsageState } from './usage.js'

/**
 * 读入追踪状态。
 * @param {string} file - 快照文件绝对路径。
 * @returns {Promise<{ state: object, available: boolean, error?: string }>}
 */
export async function loadUsage(file) {
  try {
    const text = await readFile(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.snapshots)) {
      return { state: emptyUsageState(), available: true }
    }
    return { state: parsed, available: true }
  } catch (error) {
    // 文件不存在是正常首次运行，不是故障
    if (error && error.code === 'ENOENT') {
      return { state: emptyUsageState(), available: true }
    }
    return {
      state: emptyUsageState(),
      available: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 写回追踪状态。
 * @param {string} file - 快照文件绝对路径。
 * @param {{ snapshots: Array<object> }} state
 * @returns {Promise<{ available: boolean, error?: string }>}
 */
export async function saveUsage(file, state) {
  const temporary = `${file}.tmp`
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
    return { available: true }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
