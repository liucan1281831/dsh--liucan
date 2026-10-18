/**
 * 纯逻辑：TTS 缓存与节流。
 *
 * 为什么需要：
 * - 上游（尤其百度）有频率限制，短时间多次请求会 503；
 * - 同一句话反复朗读（点击桌宠）没必要重复请求。
 *
 * 这里把「缓存键」「节流队列」做成不依赖文件系统与网络的纯函数/类，方便单测。
 *
 * @module dsh-plugin-fish-pet/lib/tts-cache
 */

import { createHash } from 'node:crypto'

/**
 * 生成缓存键。
 *
 * 只把「影响音频内容」的字段纳入：类型、文本、语种/音色、语速。
 * 故意不含 apiKey 与 baseUrl —— 换密钥不该让缓存失效。
 *
 * @param {object} source - 规范化后的声源。
 * @param {string} text - 文本。
 * @returns {string} 24 位十六进制。
 */
export function cacheKey(source, text, lang) {
  const parts = [
    source?.type ?? '',
    text ?? '',
    // 语种不同，音频不同，必须分开缓存
    lang ?? 'auto',
    // 所有会影响音频内容的参数都要纳入，否则换音色后仍命中旧缓存，
    // 表现就是「换了音色却没变化」。
    source?.lang ?? '',
    source?.voice ?? '',
    source?.voiceName ?? '',
    String(source?.speed ?? ''),
    String(source?.per ?? ''),
    String(source?.rate ?? ''),
    String(source?.pitch ?? ''),
    source?.model ?? '',
    source?.cluster ?? '',
    source?.resourceId ?? '',
    // 克隆音色由参考音频决定，必须进缓存键，否则换参考音频仍播旧声音
    source?.refWav ?? '',
    source?.region ?? '',
  ]
  return createHash('sha1').update(parts.join('\u0000'), 'utf8').digest('hex').slice(0, 24)
}

/**
 * 节流器：保证两次上游请求之间有最小间隔，并合并重复请求。
 *
 * - `run(key, fn)`：同 key 并发调用只会执行一次 fn，其余等待同一结果。
 * - 全局最小间隔由 `minIntervalMs` 控制（默认 1200ms，实测百度 2s 间隔稳定）。
 */
export function createThrottle({ minIntervalMs = 1200, now = Date.now } = {}) {
  let lastAt = 0
  const inflight = new Map()
  let queue = Promise.resolve()

  /** 等待到可以发起下一次请求的时间点。 */
  function waitTurn() {
    const at = now()
    const elapsed = at - lastAt
    const wait = Math.max(0, minIntervalMs - elapsed)
    queue = queue.then(() => new Promise(resolve => setTimeout(resolve, wait)))
    return queue.then(() => { lastAt = now() })
  }

  return {
    /**
     * 执行一次受节流的上游调用。
     * @template T
     * @param {string} key - 去重键（缓存键即可）。
     * @param {() => Promise<T>} fn - 实际请求。
     * @returns {Promise<T>}
     */
    async run(key, fn) {
      const existing = inflight.get(key)
      if (existing) return existing
      const task = (async () => {
        await waitTurn()
        try {
          return await fn()
        } finally {
          inflight.delete(key)
        }
      })()
      inflight.set(key, task)
      return task
    },
    /** 当前是否有请求在飞。 */
    get pending() {
      return inflight.size
    },
  }
}

/**
 * 简单的 LRU + TTL 内存索引，用来记住「缓存键 → 文件名」。
 *
 * 只存在于内存：重启后失效，但磁盘上的音频文件仍在（按 hash 命名），
 * 所以重启后第一次请求会命中磁盘，不会重复合成。
 */
export function createAudioIndex({ capacity = 200 } = {}) {
  const map = new Map()
  return {
    get(key) {
      const hit = map.get(key)
      if (!hit) return null
      // 触摸：LRU
      map.delete(key)
      map.set(key, hit)
      return hit
    },
    set(key, value) {
      map.delete(key)
      map.set(key, value)
      while (map.size > capacity) {
        const oldest = map.keys().next().value
        map.delete(oldest)
      }
    },
    get size() {
      return map.size
    },
  }
}

/**
 * 判断响应体是否真的是音频。
 *
 * 百度等接口在失败时会返回 JSON 或 HTML，若直接当音频播会得到无声/报错，
 * 所以要先看文件头魔数。
 *
 * @param {Buffer} buf
 * @returns {{ ok: boolean, mime: string | null }}
 */
export function sniffAudio(buf) {
  if (!buf || buf.length < 4) return { ok: false, mime: null }
  if (buf.subarray(0, 3).toString('ascii') === 'ID3') return { ok: true, mime: 'audio/mpeg' }
  // MP3 帧同步
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return { ok: true, mime: 'audio/mpeg' }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF'
    && buf.subarray(8, 12).toString('ascii') === 'WAVE') return { ok: true, mime: 'audio/wav' }
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') return { ok: true, mime: 'audio/ogg' }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ok: true, mime: 'audio/webm' }
  }
  return { ok: false, mime: null }
}

/**
 * 把上游错误响应压成一句用户能看懂的话。
 * @param {number} status
 * @param {Buffer} buf
 * @returns {string}
 */
export function describeUpstreamFailure(status, buf) {
  if (status === 403) return '上游拒绝了请求（403），该声源在你这网络可能不可用'
  if (status === 429) return '上游限流（429），稍后再试'
  if (status === 503) return '上游限流或繁忙（503），稍后再试'
  if (status >= 500) return `上游服务异常（${status}）`
  if (status >= 400) return `请求被拒绝（${status}）`
  // 有响应体但不是音频：把前 100 字给出来便于排查
  const text = buf?.toString?.('utf8') ?? ''
  const snippet = text.replace(/\s+/g, ' ').slice(0, 100)
  return snippet ? `上游返回了非音频内容：${snippet}` : '上游返回了非音频内容'
}
