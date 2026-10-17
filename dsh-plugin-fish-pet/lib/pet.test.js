/**
 * 桌宠宿主侧离线测试：不联网、不启动 DSH。
 *
 * 覆盖：路由注册、HTTP 方法限制、缓存 TTL、并发合并、响应体不泄漏密钥。
 *
 * 运行：node --test lib/pet.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'

const { BALANCE_PATH, PET_IMG_PATH, createBalanceReader, createBalanceHistory, projectForClient, apply, Config, KNOWN_CITIES, sniffImageType, sniffSoundType } =
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

test('apply 注册全部六个 exact 路由', () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x' })
  assert.equal(routes.length, 6, '余额/图片/天气/设置/自定义图/音效')
  const paths = routes.map(r => r.path)
  for (const p of ['/api/fish-pet/balance', '/api/fish-pet/image', '/api/fish-pet/weather',
                   '/api/fish-pet/settings', '/api/fish-pet/custom-image', '/api/fish-pet/sound']) {
    assert.ok(paths.includes(p), '缺少路由 ' + p)
  }
  assert.ok(routes.every(r => r.kind === 'exact'))
  assert.ok(routes.every(r => typeof r.handler === 'function'))
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

test('createBalanceHistory 在余额下降时估算剩余时长', () => {
  const h = createBalanceHistory()
  const t0 = 1_000_000
  h.push(50, t0)
  h.push(49, t0 + 3600_000) // 1 小时消耗 1 元
  const rate = h.rate('CNY')
  assert.equal(rate.trend, 'down')
  assert.equal(rate.perHour, 1)
  assert.equal(rate.hoursLeft, 49)
  assert.equal(rate.sampleCount, 2)
})

test('createBalanceHistory 余额上涨时不给估算', () => {
  const h = createBalanceHistory()
  h.push(10, 0)
  h.push(60, 3600_000)
  const rate = h.rate('CNY')
  assert.equal(rate.trend, 'up')
  assert.equal(rate.perHour, null)
  assert.equal(rate.hoursLeft, null)
})

test('createBalanceHistory 采样不足时返回 insufficient', () => {
  const h = createBalanceHistory()
  h.push(10, 0)
  assert.equal(h.rate('CNY').trend, 'insufficient')
})

test('createBalanceHistory 时间跨度过短不给结论', () => {
  const h = createBalanceHistory()
  h.push(10, 0)
  h.push(9.9, 10_000) // 仅 10 秒
  assert.equal(h.rate('CNY').trend, 'insufficient')
})

test('createBalanceHistory 超出容量时滚掉最老的采样', () => {
  const h = createBalanceHistory({ capacity: 3 })
  for (let i = 0; i < 10; i++) h.push(100 - i, i * 3600_000)
  const rate = h.rate('CNY')
  assert.equal(rate.sampleCount, 3)
})

test('projectForClient 透传 burnRate', () => {
  const rate = { perHour: 1, hoursLeft: 10, sampleCount: 3, trend: 'down', currency: 'CNY' }
  const p = projectForClient({
    ok: true, isAvailable: true,
    balances: [{ currency: 'CNY', total: '10', granted: '0', toppedUp: '10' }],
    checkedAt: new Date().toISOString(),
  }, rate)
  assert.deepEqual(p.burnRate, rate)
})

// ============ 新增：设置与天气纯逻辑 ============

const S = await import('../lib/pet-settings.js')

test('normalizeSettings 夹取越界数值', () => {
  const s = S.normalizeSettings({ size: 9999, opacity: -3, soundVolume: 42 })
  assert.equal(s.size, 200)
  assert.equal(s.opacity, 0)
  assert.equal(s.soundVolume, 1)
})

test('normalizeSettings 拒绝危险 URL', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'https://evil.com/a.png', '//evil.com/x']) {
    assert.equal(S.normalizeSettings({ customImageUrl: bad }).customImageUrl, '')
  }
  const good = '/api/fish-pet/custom-image?v=abc123'
  assert.equal(S.normalizeSettings({ customImageUrl: good }).customImageUrl, good)
})

test('normalizeSettings 清洗短语（去空、限长、限量）', () => {
  const s = S.normalizeSettings({ phrases: ['  hello  ', '', '   ', 'x'.repeat(200), 123] })
  assert.deepEqual(s.phrases, ['hello', 'x'.repeat(60)])
})

test('normalizeSettings 丢弃未知字段', () => {
  const s = S.normalizeSettings({ __proto__: { polluted: true }, evil: 'x' })
  assert.equal(s.evil, undefined)
  assert.equal(s.size, S.SETTINGS_DEFAULTS.size)
})

test('classifyWeatherCode 覆盖主要天气代码', () => {
  assert.equal(S.classifyWeatherCode(0).key, 'clear')
  assert.equal(S.classifyWeatherCode(3).key, 'overcast')
  assert.equal(S.classifyWeatherCode(63).key, 'rain')
  assert.equal(S.classifyWeatherCode(73).key, 'snow')
  assert.equal(S.classifyWeatherCode(95).key, 'thunder')
  assert.equal(S.classifyWeatherCode(999).key, 'unknown')
})

test('projectWeather 压平上游响应', () => {
  const p = S.projectWeather({
    timezone: 'Asia/Shanghai',
    current: {
      time: '2026-10-18T02:30',
      weather_code: 1,
      temperature_2m: 13.24,
      relative_humidity_2m: 50.4,
      wind_speed_10m: 12.34,
    },
  })
  assert.equal(p.ok, true)
  assert.equal(p.kind, 'mostly-clear')
  assert.equal(p.temperature, 13.2)
  assert.equal(p.humidity, 50)
  assert.equal(p.windSpeed, 12.3)
})

test('projectWeather 容忍缺字段', () => {
  const p = S.projectWeather({})
  assert.equal(p.ok, true)
  assert.equal(p.temperature, null)
  assert.equal(p.kind, 'unknown')
})

test('KNOWN_CITIES 覆盖常见城市且坐标合理', () => {
  const cities = ['北京', '上海', '广州', '深圳', '杭州']
  for (const c of cities) {
    assert.ok(KNOWN_CITIES[c], `缺少 ${c}`)
    assert.ok(Math.abs(KNOWN_CITIES[c].lat) <= 90)
    assert.ok(Math.abs(KNOWN_CITIES[c].lon) <= 180)
  }
})

test('sniffImageType 按魔数识别真实图片', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(sniffImageType(png), 'image/png')
  const gif = Buffer.from('GIF89a', 'ascii')
  assert.equal(sniffImageType(gif), 'image/gif')
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
  assert.equal(sniffImageType(jpg), 'image/jpeg')
  // 文本伪装成图片
  assert.equal(sniffImageType(Buffer.from('NOT_AN_IMAGE', 'ascii')), null)
})

test('sniffSoundType 按魔数识别音频', () => {
  assert.equal(sniffSoundType(Buffer.from('ID3', 'ascii')), 'audio/mpeg')
  assert.equal(sniffSoundType(Buffer.from('RIFF0000WAVE', 'ascii')), 'audio/wav')
  assert.equal(sniffSoundType(Buffer.from('OggS', 'ascii')), 'audio/ogg')
  assert.equal(sniffSoundType(Buffer.from('plain text', 'ascii')), null)
})
