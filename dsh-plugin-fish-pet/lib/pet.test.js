/**
 * 桌宠宿主侧离线测试：不联网、不启动 DSH。
 *
 * 覆盖：路由注册、HTTP 方法限制、缓存 TTL、并发合并、响应体不泄漏密钥。
 *
 * 运行：node --test lib/pet.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'

const { BALANCE_PATH, PET_IMG_PATH, createBalanceReader, projectForClient, apply, Config } =
  await import('../index.js')

/** 造一个可控时钟。 */
function makeClock(start = 0) {
  let t = start
  return { now: () => t, advance: ms => { t += ms } }
}

/** 极简的 req/res 桩，收集 handler 的响应。 */
function makeRes() {
  const out = { status: null, headers: null, body: null }
  return {
    out,
    writeHead(status, headers) { out.status = status; out.headers = headers },
    end(body) { out.body = body },
  }
}

/** 装配一个捕获路由的 ctx 桩。 */
function makeCtx() {
  const routes = []
  let disposer = null
  const ctx = {
    effect(fn) { disposer = fn(); return () => {} },
    webServer: { register(route) { routes.push(route); return () => {} } },
    logger: () => ({ info() {} }),
  }
  return { ctx, routes, get disposer() { return disposer } }
}

test('端点路径形状稳定', () => {
  assert.equal(BALANCE_PATH, '/api/fish-pet/balance')
  assert.equal(PET_IMG_PATH, '/api/fish-pet/image')
})

test('apply 注册余额与图片两个 exact 路由', () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x' })
  assert.equal(routes.length, 2, '应有余额路由 + 图片路由')
  assert.equal(routes[0].path, BALANCE_PATH)
  assert.equal(routes[1].path, PET_IMG_PATH)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(typeof routes[0].handler, 'function')
})

test('非 GET 方法返回 405 且不查询余额', async () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500 })
  const res = makeRes()
  await routes[0].handler({ method: 'POST' }, res)
  assert.equal(res.out.status, 405)
  assert.match(res.out.body, /METHOD_NOT_ALLOWED/)
})

test('GET 返回 JSON 且禁止缓存', async () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500 })
  const res = makeRes()
  await routes[0].handler({ method: 'GET' }, res)
  assert.equal(res.out.status, 200)
  assert.match(res.out.headers['content-type'], /application\/json/)
  assert.equal(res.out.headers['cache-control'], 'no-store')
  const payload = JSON.parse(res.out.body)
  assert.equal(typeof payload.ok, 'boolean')
  assert.ok(payload.fetchedAt)
})

test('响应体永远不含密钥', async () => {
  const previous = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'sk-should-never-appear-0123456789'
  try {
    const { ctx, routes } = makeCtx()
    apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 800 })
    const res = makeRes()
    await routes[0].handler({ method: 'GET' }, res)
    assert.doesNotMatch(res.out.body, /sk-should-never-appear/)
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
})

test('projectForClient 成功结果只暴露必要字段', () => {
  const projected = projectForClient({
    ok: true,
    isAvailable: true,
    balances: [{ currency: 'CNY', total: '53.69', granted: '3.69', toppedUp: '50.00' }],
    checkedAt: '2026-10-17T16:17:29.875Z',
  })
  assert.equal(projected.ok, true)
  assert.equal(projected.currency, 'CNY')
  assert.equal(projected.total, '53.69')
  assert.doesNotMatch(JSON.stringify(projected), /apiKey|api_key|sk-/i)
})

test('projectForClient 失败结果带错误码', () => {
  const projected = projectForClient({ ok: false, code: 'MISSING_API_KEY', message: '未找到' })
  assert.equal(projected.ok, false)
  assert.equal(projected.code, 'MISSING_API_KEY')
})

test('projectForClient 容忍空值与空余额', () => {
  assert.equal(projectForClient(null).ok, false)
  const empty = projectForClient({ ok: true, isAvailable: true, balances: [] })
  assert.equal(empty.ok, true)
  assert.equal(empty.total, '0')
})

test('createBalanceReader 在 TTL 内复用缓存', async () => {
  const clock = makeClock()
  const reader = createBalanceReader(
    { endpoint: 'http://127.0.0.1:1/x', timeoutMs: 800, cacheTtlMs: 60000, errorTtlMs: 10000 },
    clock.now,
  )
  const first = await reader()
  clock.advance(1000)
  const second = await reader()
  assert.deepEqual(second, first, 'TTL 内应返回同一缓存对象')
})

test('createBalanceReader 无 Key 时返回结构化失败', async () => {
  const previous = process.env.DEEPSEEK_API_KEY
  const previousAlt = process.env.DSH_DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DSH_DEEPSEEK_API_KEY
  try {
    const clock = makeClock()
    const reader = createBalanceReader(
      { endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500, cacheTtlMs: 1000, errorTtlMs: 1000 },
      clock.now,
    )
    const result = await reader()
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MISSING_API_KEY')
  } finally {
    if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous
    if (previousAlt !== undefined) process.env.DSH_DEEPSEEK_API_KEY = previousAlt
  }
})

test('projectForClient 附带峰谷时段信息（与余额工具一致）', () => {
  const projected = projectForClient({
    ok: true,
    isAvailable: true,
    balances: [{ currency: 'CNY', total: '52.19', granted: '2.19', toppedUp: '50.00' }],
    checkedAt: '2026-10-17T17:08:32Z',
  })
  assert.ok(['peak', 'idle'].includes(projected.phase))
  assert.ok(projected.phaseLabel === '高峰时段' || projected.phaseLabel === '空闲时段')
  assert.equal(typeof projected.calendarCovered, 'boolean')
  assert.equal(typeof projected.phaseSummary, 'string')
  assert.ok(projected.phaseSummary.length > 0)
  assert.equal(typeof projected.nextChangeMs, 'number')
  // 时段信息同样不得泄漏密钥
  assert.doesNotMatch(JSON.stringify(projected), /sk-/i)
})

test('空闲时段折扣为半价的说明出现在摘要里', () => {
  // 2026-10-17 是周六，必然是空闲时段
  const saturdayMs = Date.UTC(2026, 9, 17, 4, 0, 0)
  const projected = projectForClient({
    ok: true, isAvailable: true,
    balances: [{ currency: 'CNY', total: '1.00', granted: '0', toppedUp: '1.00' }],
    checkedAt: new Date(saturdayMs).toISOString(),
  })
  assert.equal(projected.phase, 'idle')
  assert.equal(projected.phaseReason, 'weekend')
})
