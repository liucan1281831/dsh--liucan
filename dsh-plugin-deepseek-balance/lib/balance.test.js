/**
 * 纯逻辑离线测试：不联网、不需要 DSH、不依赖真实 Key。
 * 用本地假服务模拟 DeepSeek 余额接口，逐个覆盖成功与各类失败路径。
 *
 * 运行：node --test lib/balance.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import {
  BALANCE_ENDPOINT,
  KEY_ENV_NAMES,
  redact,
  resolveApiKey,
  normalizeBalance,
  fetchBalance,
} from './balance.js'

const FAKE_KEY = 'sk-testkey0123456789abcdef'

/** 起一个本地假接口，返回指定状态码与正文。 */
async function withFakeEndpoint(status, body, run) {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${FAKE_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":"bad key"}')
      return
    }
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await run(`http://127.0.0.1:${port}/user/balance`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('BALANCE_ENDPOINT 指向官方端点', () => {
  assert.equal(BALANCE_ENDPOINT, 'https://api.deepseek.com/user/balance')
})

test('redact 抹掉密钥原文与形似 sk- 的片段', () => {
  assert.equal(redact(`bad ${FAKE_KEY} here`, FAKE_KEY), 'bad [redacted] here')
  assert.equal(redact('leak sk-abcdefghijklmn'), 'leak [redacted]')
  assert.equal(redact(''), '')
  assert.equal(redact(undefined), '')
})

test('resolveApiKey 按顺序读取环境变量', () => {
  assert.deepEqual(resolveApiKey({}), { key: null, source: null })
  assert.deepEqual(resolveApiKey({ DEEPSEEK_API_KEY: '  ' }), { key: null, source: null })
  assert.deepEqual(
    resolveApiKey({ DEEPSEEK_API_KEY: ' a-key ' }),
    { key: 'a-key', source: 'DEEPSEEK_API_KEY' },
  )
  assert.deepEqual(
    resolveApiKey({ DSH_DEEPSEEK_API_KEY: 'b-key' }),
    { key: 'b-key', source: 'DSH_DEEPSEEK_API_KEY' },
  )
  // 优先 DEEPSEEK_API_KEY
  assert.equal(
    resolveApiKey({ DEEPSEEK_API_KEY: 'first', DSH_DEEPSEEK_API_KEY: 'second' }).key,
    'first',
  )
  assert.deepEqual(KEY_ENV_NAMES, ['DEEPSEEK_API_KEY', 'DSH_DEEPSEEK_API_KEY'])
})

test('normalizeBalance 处理官方 schema', () => {
  const out = normalizeBalance({
    is_available: true,
    balance_infos: [{
      currency: 'CNY',
      total_balance: '110.00',
      granted_balance: '10.00',
      topped_up_balance: '100.00',
    }],
  })
  assert.equal(out.isAvailable, true)
  assert.deepEqual(out.balances[0], {
    currency: 'CNY',
    total: '110.00',
    granted: '10.00',
    toppedUp: '100.00',
  })
})

test('normalizeBalance 容忍脏数据而不抛错', () => {
  assert.deepEqual(normalizeBalance(null), { isAvailable: false, balances: [] })
  assert.deepEqual(normalizeBalance({}), { isAvailable: false, balances: [] })
  assert.deepEqual(
    normalizeBalance({ balance_infos: [{}, null, 'x'] }),
    { isAvailable: false, balances: [{
      currency: 'UNKNOWN', total: '0', granted: '0', toppedUp: '0',
    }] },
  )
})

test('fetchBalance 缺 Key 时返回 MISSING_API_KEY 且不发起请求', async () => {
  const result = await fetchBalance({ apiKey: undefined })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'MISSING_API_KEY')
  assert.match(result.message, /DEEPSEEK_API_KEY/)
})

test('fetchBalance 成功路径返回规范数据', async () => {
  await withFakeEndpoint(200, {
    is_available: true,
    balance_infos: [{
      currency: 'CNY',
      total_balance: '88.50',
      granted_balance: '8.50',
      topped_up_balance: '80.00',
    }],
  }, async endpoint => {
    const result = await fetchBalance({ apiKey: FAKE_KEY, endpoint })
    assert.equal(result.ok, true)
    assert.equal(result.isAvailable, true)
    assert.equal(result.balances[0].total, '88.50')
    assert.ok(result.checkedAt)
  })
})

test('fetchBalance 401 给出清晰提示且不回显密钥', async () => {
  const { endpoint, close } = await startBadKeyEndpoint()
  try {
    const result = await fetchBalance({
      apiKey: 'sk-wrong-key-abcdefghij',
      endpoint,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'HTTP_401')
    assert.match(result.message, /API Key 无效/)
    assert.doesNotMatch(result.message, /sk-wrong-key/)
  } finally {
    await close()
  }
})

/** 起一个始终返回 401 的端点，用于断言错误信息不泄漏密钥。 */
async function startBadKeyEndpoint() {
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end('{"error":"bad sk-wrong-key-abcdefghij"}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    endpoint: `http://127.0.0.1:${port}/user/balance`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('fetchBalance 上游回显密钥时错误信息被脱敏', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(`upstream echo ${FAKE_KEY}`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const result = await fetchBalance({
      apiKey: FAKE_KEY,
      endpoint: `http://127.0.0.1:${port}/user/balance`,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'HTTP_500')
    assert.doesNotMatch(result.message, /sk-testkey/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('fetchBalance 非法 JSON 返回 BAD_JSON', async () => {
  await withFakeEndpoint(200, 'not-json', async endpoint => {
    const result = await fetchBalance({ apiKey: FAKE_KEY, endpoint })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BAD_JSON')
  })
})

test('fetchBalance 超时返回 TIMEOUT', async () => {
  const server = createServer(() => { /* 永不响应 */ })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const result = await fetchBalance({
      apiKey: FAKE_KEY,
      endpoint: `http://127.0.0.1:${port}/user/balance`,
      timeoutMs: 1000,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'TIMEOUT')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('fetchBalance 连接失败返回 NETWORK_ERROR', async () => {
  const result = await fetchBalance({
    apiKey: FAKE_KEY,
    endpoint: 'http://127.0.0.1:1/user/balance',
    timeoutMs: 3000,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NETWORK_ERROR')
  assert.doesNotMatch(result.message, /sk-testkey/)
})
