/**
 * 纯逻辑：查询 DeepSeek 余额并规范化结果。
 *
 * 与 cordis 完全解耦，便于离线单测——这样验证「查询正确」不需要拉起整台 DSH。
 *
 * 安全约定：
 * 1. API Key 只从环境变量读取，绝不写入返回值、日志或错误消息。
 * 2. 任何异常路径的 message 都要过一遍 redact()，防止上游错误原文带回 Key。
 * 3. 只发 GET 到固定端点，不接受调用方传入 URL（避免把 Key 发去别处）。
 *
 * @module dsh-plugin-deepseek-balance/lib/balance
 */

/** 官方余额端点（固定，不可由调用方覆盖）。 */
export const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance'

/** 读取 API Key 的环境变量名，按顺序尝试。 */
export const KEY_ENV_NAMES = ['DEEPSEEK_API_KEY', 'DSH_DEEPSEEK_API_KEY']

/** 请求超时：余额接口很快，超过这个时间视为网络问题。 */
const REQUEST_TIMEOUT_MS = 15000

/**
 * 把可能含密钥的文本抹掉。
 * @param {string} text - 任意文本。
 * @param {string} [secret] - 需要额外抹掉的密钥原文。
 * @returns {string} 已抹除敏感片段的文本。
 */
export function redact(text, secret) {
  let out = String(text ?? '')
  if (secret) out = out.split(secret).join('[redacted]')
  // 兜底：任何形似 DeepSeek Key 的片段（sk- 开头）一并抹掉
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
  return out
}

/**
 * 从环境变量解析 API Key。
 * @param {Record<string, string | undefined>} [env] - 环境变量表，默认 process.env。
 * @returns {{ key: string | null, source: string | null }}
 */
export function resolveApiKey(env = process.env) {
  for (const name of KEY_ENV_NAMES) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') {
      return { key: value.trim(), source: name }
    }
  }
  return { key: null, source: null }
}

/**
 * 把官方返回的原始 JSON 规范成稳定形状。
 *
 * 官方 schema：
 *   { is_available: boolean, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
 *
 * @param {unknown} raw - 上游 JSON。
 * @returns {{ isAvailable: boolean, balances: Array<{currency: string, total: string, granted: string, toppedUp: string}> }}
 */
export function normalizeBalance(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const infos = Array.isArray(source.balance_infos) ? source.balance_infos : []
  const balances = infos
    .filter(info => info && typeof info === 'object')
    .map(info => ({
      currency: String(info.currency ?? 'UNKNOWN'),
      total: String(info.total_balance ?? '0'),
      granted: String(info.granted_balance ?? '0'),
      toppedUp: String(info.topped_up_balance ?? '0'),
    }))
  return { isAvailable: Boolean(source.is_available), balances }
}

/**
 * 查询余额。
 * @param {{ apiKey?: string, endpoint?: string, timeoutMs?: number }} options
 * @returns {Promise<{ ok: true, isAvailable: boolean, balances: Array<object>, checkedAt: string }
 *   | { ok: false, code: string, message: string }>}
 */
export async function fetchBalance(options = {}) {
  const endpoint = options.endpoint ?? BALANCE_ENDPOINT
  const apiKey = options.apiKey
  if (!apiKey) {
    return {
      ok: false,
      code: 'MISSING_API_KEY',
      message: `未找到 API Key，请设置环境变量 ${KEY_ENV_NAMES.join(' 或 ')} 后重启 DSH。`,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })

    const text = await response.text()
    if (!response.ok) {
      return {
        ok: false,
        code: `HTTP_${response.status}`,
        message: redact(
          response.status === 401
            ? 'API Key 无效或已被撤销（HTTP 401）。'
            : `余额接口返回 HTTP ${response.status}：${text.slice(0, 300)}`,
          apiKey,
        ),
      }
    }

    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return { ok: false, code: 'BAD_JSON', message: '余额接口返回的不是合法 JSON。' }
    }

    const normalized = normalizeBalance(payload)
    return {
      ok: true,
      isAvailable: normalized.isAvailable,
      balances: normalized.balances,
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    return {
      ok: false,
      code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: aborted
        ? `查询余额超时（${options.timeoutMs ?? REQUEST_TIMEOUT_MS}ms）。`
        : `查询余额失败：${redact(error?.message ?? error, apiKey)}`,
    }
  } finally {
    clearTimeout(timer)
  }
}
