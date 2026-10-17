/**
 * DeepSeek 余额插件（宿主侧）。
 *
 * 只注册一个宿主工具 `deepseek_balance`，不声明 dsh.client ——
 * 这样不会触发 client-modules 的 compose 检查，插件本身不可能拖垮启动。
 *
 * @module dsh-plugin-deepseek-balance
 */

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { fetchBalance, resolveApiKey, redact } from './balance.js'
import { resolvePhase, describePhase, beijingParts } from './peak.js'
import {
  appendSnapshot,
  computeDailyUsage,
  formatDailyUsage,
  parseAmount,
} from './usage.js'
import { loadUsage, saveUsage } from './usage-store.js'

export const name = 'deepseek-balance'
export const inject = ['tools']

/** 默认快照文件位置：DSH 用户目录下，与 profile 平级。 */
const DEFAULT_USAGE_FILE = join(homedir(), '.dsh', 'deepseek-balance', 'usage.json')

/** 插件配置。 */
export const Config = z.object({
  endpoint: z.string().default('https://api.deepseek.com/user/balance'),
  timeoutMs: z.number().min(1000).max(120000).default(15000),
  /** 今日消耗快照文件；设为空字符串可关闭今日消耗追踪。 */
  usageFile: z.string().default(DEFAULT_USAGE_FILE),
})

/**
 * 把查询结果渲染成一行可读文本。
 * @param {Awaited<ReturnType<typeof fetchBalance>>} result
 * @returns {string}
 */
function renderSummary(result) {
  if (!result.ok) return `余额查询失败（${result.code}）：${result.message}`
  if (result.balances.length === 0) {
    return '余额接口未返回任何币种信息。'
  }
  const parts = result.balances.map(b => {
    const detail = []
    if (b.granted && b.granted !== '0') detail.push(`赠送 ${b.granted}`)
    if (b.toppedUp && b.toppedUp !== '0') detail.push(`充值 ${b.toppedUp}`)
    const suffix = detail.length > 0 ? `（${detail.join('，')}）` : ''
    return `${b.total} ${b.currency}${suffix}`
  })
  const available = result.isAvailable ? '余额充足' : '余额不足'
  return `${available}：${parts.join('；')}`
}

/**
 * 把账户余额、今日消耗与当前峰谷时段合成一段完整输出。
 * @param {Awaited<ReturnType<typeof fetchBalance>>} balance - 余额查询结果。
 * @param {string} phaseText - 人可读的时段摘要。
 * @param {string} usageText - 人可读的今日消耗摘要。
 * @returns {string}
 */
function renderFull(balance, phaseText, usageText) {
  const head = renderSummary(balance)
  return `${head}\n${usageText}\n\n时段：${phaseText}`
}

/**
 * 读取快照、追加本次余额、算今日消耗、再写回。
 *
 * 任何一步失败都降级为「无法读取今日消耗」，绝不因为追踪失败而让余额查询失败。
 * @param {string} file - 快照文件路径；空字符串表示关闭追踪。
 * @param {Awaited<ReturnType<typeof fetchBalance>>} result - 余额查询结果。
 * @param {number} now - 本次查询时刻。
 * @returns {Promise<ReturnType<typeof computeDailyUsage> & { storeError?: string | null }>}
 */
async function trackUsage(file, result, now) {
  const dateKey = beijingParts(now).dateKey
  const balances = result.ok ? result.balances : []
  const currentTotal = balances.length > 0 ? parseAmount(balances[0].total) : null
  const currentCurrency = balances[0]?.currency

  if (!file || currentTotal === null) {
    // 没有文件配置或没拿到余额：只能基于内存里没有的记录算，结果为 no-snapshot
    return computeDailyUsage({ snapshots: [] }, dateKey, currentTotal ?? undefined, currentCurrency)
  }

  const loaded = await loadUsage(file)
  if (!loaded.available) {
    const unavailable = computeDailyUsage(loaded.state, dateKey, currentTotal, currentCurrency)
    return { ...unavailable, storeError: loaded.error ?? 'unknown' }
  }

  const nextState = appendSnapshot(loaded.state, {
    dateKey,
    timeMs: now,
    balances,
  })
  const saved = await saveUsage(file, nextState)
  const usage = computeDailyUsage(nextState, dateKey, currentTotal, currentCurrency)
  return { ...usage, storeError: saved.available ? null : (saved.error ?? 'unknown') }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ endpoint: string, timeoutMs: number }} config
 */
export function apply(ctx, config) {
  // 启动时只做一次存在性检查，绝不在日志里回显密钥内容
  const { key, source } = resolveApiKey()
  if (key) {
    ctx.logger?.('deepseek-balance').info('API Key 已从 %s 读取', source)
  } else {
    ctx.logger?.('deepseek-balance').warn(
      '未找到 DEEPSEEK_API_KEY，deepseek_balance 工具将返回 MISSING_API_KEY。',
    )
  }

  // tools.register 自身返回注销函数，直接作为插件 disposer 由 cordis 接管
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'deepseek_balance',
        description:
          '查询当前配置的 DeepSeek API Key 对应的账户余额。返回各币种的总余额、赠送余额与充值余额，'
          + '并标明余额是否足以继续调用；同时附带当前处于 DeepSeek 的高峰时段还是空闲时段'
          + '（按官方规则：北京时间周一至周五 9:00-12:00、14:00-18:00 为高峰，其余为半价空闲），'
          + '以及距下一次时段切换还有多久。另给出今日已用金额（基于本插件自己记录的快照，'
          + '余额接口本身不提供历史消耗）。API Key 来自宿主环境变量，工具不会显示、记录或回传密钥。',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              summary: { type: 'string', required: true },
              isAvailable: { type: 'boolean' },
              balances: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    currency: { type: 'string', required: true },
                    total: { type: 'string', required: true },
                    granted: { type: 'string', required: true },
                    toppedUp: { type: 'string', required: true },
                  },
                },
              },
              errorCode: { type: 'string' },
              checkedAt: { type: 'string' },
              phase: { type: 'string' },
              phaseReason: { type: 'string' },
              calendarCovered: { type: 'boolean' },
              todayUsed: { type: 'number' },
              todayBaseline: { type: 'number' },
            },
          },
          // defineTool 从 output.render 读取渲染器；放在顶层会被忽略并在渲染时抛错
          render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        async execute() {
          const { key: apiKey } = resolveApiKey()
          const result = await fetchBalance({
            apiKey: apiKey ?? undefined,
            endpoint: config.endpoint,
            timeoutMs: config.timeoutMs,
          })
          const now = Date.now()
          const phase = resolvePhase(now)
          const phaseText = describePhase(now)
          const usage = await trackUsage(config.usageFile, result, now)
          if (!result.ok) {
            // 余额都没拿到时不输出「今日已用 0」，那会让人误以为今天没花钱
            return {
              ok: false,
              summary: `${renderSummary(result)}\n\n时段：${phaseText}`,
              errorCode: result.code,
              phase: phase.phase,
              phaseReason: phase.reason,
              calendarCovered: phase.calendarCovered,
            }
          }
          const usageText = usage.storeError
            ? `今日已用：无法读取快照（${usage.storeError}）`
            : formatDailyUsage(usage)
          return {
            ok: true,
            summary: renderFull(result, phaseText, usageText),
            isAvailable: result.isAvailable,
            balances: result.balances,
            checkedAt: result.checkedAt,
            phase: phase.phase,
            phaseReason: phase.reason,
            calendarCovered: phase.calendarCovered,
            todayUsed: usage.used,
            todayBaseline: usage.baseline,
          }
        },
        presentCall: () => ({
          card: 'generic',
          title: '查询 DeepSeek 余额',
          kind: 'other',
        }),
      }),
    ),
  )
}

export { redact }
