/**
 * 桌宠插件（宿主侧）。
 *
 * 职责：暴露一个只读的 HTTP 端点 `/api/fish-pet/balance`，
 * 供前端悬浮组件（client.js）拉取余额。带 TTL 缓存，避免前端轮询打爆官方接口。
 *
 * 为什么用路由而不是 index-inject：
 * index-inject 的 value 会被 JSON 序列化，函数会被丢弃（实测得到空对象 `{}`），
 * 因此不能承载「刷新」这类行为，只能传纯数据；而余额需要按需刷新，
 * 走 webServer.register 是唯一正确的通道。
 *
 * 安全约定与余额插件一致：API Key 只从环境变量读取，绝不出现在响应体和日志里。
 *
 * @module dsh-plugin-fish-pet
 */

import z from '@deepseek-ai/schemastery'
import { readFile } from 'node:fs/promises'
import { fetchBalance, resolveApiKey } from 'dsh-plugin-deepseek-balance/balance'
import {
  resolvePhase,
  describePhase,
  untilNextChange,
  phaseLabel,
  formatDuration,
} from 'dsh-plugin-deepseek-balance/peak'

export const name = 'fish-pet'

/** 前端拉取余额的路径（与 client.js 保持一致）。 */
export const BALANCE_PATH = '/api/fish-pet/balance'

/** 桌宠原图端点（与 client.js 的 PET_IMG 保持一致）。 */
export const PET_IMG_PATH = '/api/fish-pet/image'

/** 桌宠图片文件（相对本模块，透明背景 PNG）。 */
const PET_IMAGE_FILE = new URL('./pet.png', import.meta.url)

/** 所需服务：HTTP 路由注册。 */
export const inject = ['webServer']

/** 插件配置。 */
export const Config = z.object({
  /** 余额缓存有效期（毫秒）；前端轮询更频繁时命中缓存。 */
  cacheTtlMs: z.number().min(5000).max(3600000).default(60000),
  /** 失败结果的缓存期（毫秒），比成功短，避免错误态粘住。 */
  errorTtlMs: z.number().min(1000).max(600000).default(10000),
  /** 余额历史采样点数上限：用于估算消耗速率，只在内存里滚动。 */
  historyCapacity: z.number().min(2).max(1000).default(60),
  /** 单次查询超时。 */
  timeoutMs: z.number().min(1000).max(60000).default(15000),
  /** 官方余额端点。 */
  endpoint: z.string().default('https://api.deepseek.com/user/balance'),
})

/**
 * 创建带 TTL 的余额读取器。
 *
 * 并发调用会合并到同一个 in-flight Promise，避免前端连刷时打出多份上游请求。
 *
 * @param {{ endpoint: string, timeoutMs: number, cacheTtlMs: number, errorTtlMs: number }} config
 * @param {() => number} [now] - 可注入时钟，便于测试。
 * @returns {() => Promise<object>} 读取函数，返回 fetchBalance 的原始结果。
 */
export function createBalanceReader(config, now = Date.now) {
  let cached = null
  let cachedAt = 0
  let inflight = null

  return async function read() {
    const at = now()
    if (cached) {
      const ttl = cached.ok ? config.cacheTtlMs : (config.errorTtlMs ?? 10000)
      if (at - cachedAt < ttl) return cached
    }
    if (inflight) return inflight

    inflight = (async () => {
      try {
        const { key: apiKey } = resolveApiKey()
        const result = await fetchBalance({
          apiKey: apiKey ?? undefined,
          endpoint: config.endpoint,
          timeoutMs: config.timeoutMs,
        })
        cached = result
        cachedAt = now()
        return result
      } finally {
        inflight = null
      }
    })()

    return inflight
  }
}

/**
 * 余额变化历史追踪器。
 *
 * 目的：回答「余额还剩多少」之外的问题——「按现在的速度还能用多久」。
 * 只保留最近 N 个采样点，在内存里滚动，不落盘、不上传。
 *
 * @param {{ capacity?: number }} [options]
 * @returns {{ push: (total: number, atMs: number) => void, rate: (currency: string) => object }}
 */
export function createBalanceHistory(options = {}) {
  const capacity = options.capacity ?? 60
  /** @type {Array<{ total: number, atMs: number }>} */
  let samples = []

  return {
    /** 记录一个采样点；同一时刻重复写入会覆盖。 */
    push(total, atMs) {
      if (!Number.isFinite(total) || !Number.isFinite(atMs)) return
      const last = samples[samples.length - 1]
      if (last && last.atMs === atMs) {
        last.total = total
        return
      }
      samples.push({ total, atMs })
      if (samples.length > capacity) samples.shift()
    },

    /**
     * 估算消耗速率与剩余可用时长。
     *
     * 只在「余额确实下降过」时给出结论；上涨（充值）或数据不足时返回 null，
     * 不编造一个数字。
     *
     * @param {string} currency - 币种，仅用于标签。
     * @returns {{
     *   perHour: number | null,
     *   hoursLeft: number | null,
     *   sampleCount: number,
     *   trend: 'down' | 'up' | 'flat' | 'insufficient',
     *   currency: string,
     * }}
     */
    rate(currency = '') {
      if (samples.length < 2) {
        return { perHour: null, hoursLeft: null, sampleCount: samples.length, trend: 'insufficient', currency }
      }
      const first = samples[0]
      const last = samples[samples.length - 1]
      const elapsedMs = last.atMs - first.atMs
      // 时间跨度太短会算出荒谬的速率
      if (elapsedMs < 60 * 1000) {
        return { perHour: null, hoursLeft: null, sampleCount: samples.length, trend: 'insufficient', currency }
      }
      const delta = last.total - first.total
      const hours = elapsedMs / 3600000
      if (Math.abs(delta) < 0.0001) {
        return { perHour: 0, hoursLeft: null, sampleCount: samples.length, trend: 'flat', currency }
      }
      if (delta > 0) {
        return { perHour: null, hoursLeft: null, sampleCount: samples.length, trend: 'up', currency }
      }
      const perHour = -delta / hours
      const hoursLeft = perHour > 0 ? last.total / perHour : null
      return { perHour, hoursLeft, sampleCount: samples.length, trend: 'down', currency }
    },
  }
}

/**
 * 把查询结果压成前端投影。绝不包含任何密钥字段。
 * @param {object} result - fetchBalance 的结果。
 * @returns {object} 前端可用的纯数据。
 */
export function projectForClient(result, rate = null) {
  if (!result || result.ok !== true) {
    return {
      ok: false,
      code: result?.code ?? 'UNKNOWN',
      message: result?.message ?? '余额暂不可用',
      fetchedAt: new Date().toISOString(),
    }
  }
  const primary = Array.isArray(result.balances) && result.balances.length > 0
    ? result.balances[0]
    : null
  // 峰谷时段：与余额工具保持一致，桌宠也要能看到当前计价时段
  const phase = resolvePhase()
  const next = untilNextChange()
  return {
    ok: true,
    isAvailable: result.isAvailable,
    currency: primary?.currency ?? '',
    total: primary?.total ?? '0',
    granted: primary?.granted ?? '0',
    toppedUp: primary?.toppedUp ?? '0',
    fetchedAt: result.checkedAt ?? new Date().toISOString(),
    phase: phase.phase,
    phaseLabel: phaseLabel(phase.phase),
    phaseReason: phase.reason,
    phaseSummary: describePhase(),
    nextPhase: next.nextPhase,
    nextPhaseLabel: phaseLabel(next.nextPhase),
    nextChangeMs: next.nextChangeMs,
    nextChangeText: next.nextChangeMs > 0 ? formatDuration(next.nextChangeMs) : '',
    calendarCovered: phase.calendarCovered,
    // 消耗速率（采样不足、余额上涨或持平时为 null，前端据此不展示估算）
    burnRate: rate,
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ cacheTtlMs: number, errorTtlMs: number, timeoutMs: number, endpoint: string }} config
 */
export function apply(ctx, config) {
  const read = createBalanceReader(config)
  // 余额历史只在内存中滚动，用于估算「还能用多久」，不落盘
  const history = createBalanceHistory({ capacity: config.historyCapacity ?? 60 })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BALANCE_PATH,
    async handler(req, res) {
      // 只读端点：仅允许 GET
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' })
        res.end('{"ok":false,"code":"METHOD_NOT_ALLOWED"}')
        return
      }
      let payload
      try {
        const result = await read()
        let rate = null
        if (result?.ok === true) {
          const primary = Array.isArray(result.balances) && result.balances.length > 0
            ? result.balances[0]
            : null
          const total = Number.parseFloat(primary?.total ?? '')
          if (Number.isFinite(total)) {
            history.push(total, Date.now())
            rate = history.rate(primary?.currency ?? '')
          }
        }
        payload = projectForClient(result, rate)
      } catch (error) {
        payload = {
          ok: false,
          code: 'CLIENT_ERROR',
          message: String(error?.message ?? error),
          fetchedAt: new Date().toISOString(),
        }
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        // 余额是隐私数据，禁止任何中间层缓存
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(payload))
    },
  }), 'fish-pet: balance route')

  // 提供桌宠原图（透明背景 PNG）。只暴露这一个固定文件，不接受任何路径参数，
  // 因此不存在目录穿越面。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PET_IMG_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      try {
        const png = await readFile(PET_IMAGE_FILE)
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(png.length),
          // 图片随插件版本变化，允许浏览器缓存一天
          'cache-control': 'public, max-age=86400',
        })
        res.end(png)
      } catch (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`pet image unavailable: ${error?.code ?? 'UNKNOWN'}`)
      }
    },
  }), 'fish-pet: image route')

  ctx.logger?.('fish-pet').info('桌宠端点已就绪：%s, %s', BALANCE_PATH, PET_IMG_PATH)
}
