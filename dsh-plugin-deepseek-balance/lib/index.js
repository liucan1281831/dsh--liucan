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
import { fetchBalance, resolveApiKey, redact } from './balance.js'
import { resolvePhase, describePhase } from './peak.js'

export const name = 'deepseek-balance'
export const inject = ['tools']

/** 插件配置。 */
export const Config = z.object({
  endpoint: z.string().default('https://api.deepseek.com/user/balance'),
  timeoutMs: z.number().min(1000).max(120000).default(15000),
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
 * 把账户余额与当前峰谷时段合成一段完整输出。
 * @param {Awaited<ReturnType<typeof fetchBalance>>} balance - 余额查询结果。
 * @param {string} phaseText - 人可读的时段摘要。
 * @returns {string}
 */
function renderFull(balance, phaseText) {
  const head = renderSummary(balance)
  return `${head}\n\n时段：${phaseText}`
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
          + '以及距下一次时段切换还有多久。API Key 来自宿主环境变量，工具不会显示、记录或回传密钥。',
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
          const phase = resolvePhase()
          const phaseText = describePhase()
          if (!result.ok) {
            return {
              ok: false,
              summary: renderFull(result, phaseText),
              errorCode: result.code,
              phase: phase.phase,
              phaseReason: phase.reason,
              calendarCovered: phase.calendarCovered,
            }
          }
          return {
            ok: true,
            summary: renderFull(result, phaseText),
            isAvailable: result.isAvailable,
            balances: result.balances,
            checkedAt: result.checkedAt,
            phase: phase.phase,
            phaseReason: phase.reason,
            calendarCovered: phase.calendarCovered,
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
