/**
 * 桌宠宿主侧离线测试：不联网、不启动 DSH。
 *
 * 覆盖：路由注册、HTTP 方法限制、缓存 TTL、并发合并、响应体不泄漏密钥。
 *
 * 运行：node --test lib/pet.test.js
 */

import test, { after } from 'node:test'

// 测试专用数据目录：避免读写开发者真实的 .data
const TEST_DATA = mkdtempSync(join(tmpdir(), 'fishpet-test-'))
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { makeZip } from './test-zip.js'

const {
  BALANCE_PATH, PET_IMG_PATH, LIVE2D_MODELS_PATH, LIVE2D_MODEL_BASE, LIVE2D_RUNTIME_PATH,
  ANIMATIONS_PATH, ANIMATION_BASE_PATH, ANIMATION_MATTE_BASE_PATH,
  createBalanceReader, createBalanceHistory, projectForClient, apply, Config, KNOWN_CITIES,
  sniffImageType, sniffSoundType,
} = await import('../index.js')

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
const DISPOSERS = []

function makeCtx() {
  const routes = []
  let disposer = null
  const ctx = {
    effect(fn) { const d = fn(); if (typeof d === 'function') DISPOSERS.push(d); return () => {} },
    webServer: { register(route) { routes.push(route); return () => {} } },
    logger: () => ({ info() {} }),
  }
  return { ctx, routes, get disposer() { return disposer } }
}

test('端点路径形状稳定', () => {
  assert.equal(BALANCE_PATH, '/api/fish-pet/balance')
  assert.equal(PET_IMG_PATH, '/api/fish-pet/image')
})

test('apply 注册全部 HTTP 路由（含 Live2D）', () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', dataDir: TEST_DATA })
  const exact = routes.filter(route => route.kind === 'exact').map(route => route.path)
  const prefix = routes.filter(route => route.kind === 'prefix').map(route => route.path)

  // 必需清单：新增端点时必须在这里登记，否则本条会失败
  const REQUIRED_EXACT = [
    '/api/fish-pet/balance', '/api/fish-pet/image', '/api/fish-pet/weather',
    '/api/fish-pet/settings', '/api/fish-pet/custom-image', '/api/fish-pet/sound',
    '/api/fish-pet/sound-status', '/api/fish-pet/voices', '/api/fish-pet/voices/catalog',
    '/api/fish-pet/speak', '/api/fish-pet/speak-audio', '/api/fish-pet/voice-clone',
    '/api/fish-pet/harvest', '/api/fish-pet/harvest/audio', '/api/fish-pet/power',
    '/api/fish-pet/client-error',
    LIVE2D_MODELS_PATH,
    ANIMATIONS_PATH,
  ]
  for (const p of REQUIRED_EXACT) assert.ok(exact.includes(p), '缺少路由 ' + p)
  assert.equal(exact.length, REQUIRED_EXACT.length, '存在未登记的 exact 路由')
  assert.equal(new Set(exact).size, exact.length, '路由不能重复')
  assert.deepEqual(prefix.sort(), [
    LIVE2D_MODEL_BASE, LIVE2D_RUNTIME_PATH, ANIMATION_BASE_PATH, ANIMATION_MATTE_BASE_PATH,
  ].sort())
})

test('非 GET 方法返回 405 且不查询余额', async () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', dataDir: TEST_DATA, timeoutMs: 500 })
  const res = makeRes()
  await routes[0].handler({ method: 'POST' }, res)
  assert.equal(res.out.status, 405)
  assert.match(res.out.body, /METHOD_NOT_ALLOWED/)
})

test('音效状态接口在没有上传文件时报告 builtin', async () => {
  // 用独立临时目录：否则会读到开发机上真实上传的音效，测试就不隔离了
  const tmp = await mkdtemp(join(tmpdir(), 'fishpet-sound-'))
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500, dataDir: tmp })
  const route = routes.find(r => r.path === '/api/fish-pet/sound-status')
  assert.ok(route, '缺少音效状态路由')
  const res = makeRes()
  await route.handler({ method: 'GET' }, res)
  assert.equal(res.out.status, 200)
  const payload = JSON.parse(res.out.body)
  assert.equal(payload.ok, true)
  // 测试环境没有上传过音效，应回落到内置合成音
  assert.equal(payload.source, 'builtin')
  assert.equal(payload.uploaded, null)
  await rm(tmp, { recursive: true, force: true })
})

test('音效状态接口拒绝非 GET 方法', async () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', dataDir: TEST_DATA, timeoutMs: 500 })
  const route = routes.find(r => r.path === '/api/fish-pet/sound-status')
  const res = makeRes()
  await route.handler({ method: 'POST' }, res)
  assert.equal(res.out.status, 405)
})

test('GET 返回 JSON 且禁止缓存', async () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', dataDir: TEST_DATA, timeoutMs: 500 })
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
    apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', dataDir: TEST_DATA, timeoutMs: 800 })
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
  // 尺寸上限与 SCALE_LIMITS × SIZE_BASE 对齐（260% × 76 = 198px）
  assert.equal(s.size, S.percentToSize(260))
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

test('locked 默认关闭，只有显式 true 才锁定', () => {
  assert.equal(S.SETTINGS_DEFAULTS.locked, false)
  assert.equal(S.normalizeSettings({}).locked, false)
  assert.equal(S.normalizeSettings({ locked: true }).locked, true)
  // 字符串 "true"、1 等一律不认
  assert.equal(S.normalizeSettings({ locked: 'true' }).locked, false)
  assert.equal(S.normalizeSettings({ locked: 1 }).locked, false)
})

test('sizeToPercent 以 76px 为 100%', () => {
  assert.equal(S.sizeToPercent(76), 100)
  assert.equal(S.sizeToPercent(38), 50)
  assert.equal(S.sizeToPercent(197), 259)
  assert.equal(S.sizeToPercent(undefined), 100)
})

test('percentToSize 与 sizeToPercent 互逆，并夹到允许范围', () => {
  assert.equal(S.percentToSize(100), 76)
  assert.equal(S.percentToSize(50), 38)
  assert.equal(S.percentToSize(200), 152)
  // 超出范围夹取
  assert.equal(S.percentToSize(1), 38)
  assert.equal(S.percentToSize(9999), 198)
  assert.equal(S.percentToSize(Number.NaN), 76)
})

test('缩放百分比与尺寸往返稳定（允许取整误差 ±1%）', () => {
  for (const pct of [50, 75, 100, 125, 150, 200, 260]) {
    const back = S.sizeToPercent(S.percentToSize(pct))
    assert.ok(Math.abs(back - pct) <= 1, `percent ${pct} → ${back}`)
  }
})

test('默认尺寸 76px 恰好是 100%，且落在缩放允许范围内', () => {
  assert.equal(S.SETTINGS_DEFAULTS.size, S.SIZE_BASE)
  assert.equal(S.sizeToPercent(S.SETTINGS_DEFAULTS.size), 100)
  const [lo, hi] = S.SCALE_LIMITS
  assert.ok(100 >= lo * 100 && 100 <= hi * 100)
})

test('缩放上下限与 normalizeSettings 的 size 区间不冲突', () => {
  const minSize = S.percentToSize(50)
  const maxSize = S.percentToSize(260)
  // 经过宿主规范化后尺寸不应被改掉
  assert.equal(S.normalizeSettings({ size: minSize }).size, minSize)
  assert.equal(S.normalizeSettings({ size: maxSize }).size, maxSize)
})

test('锁定状态可以与缩放尺寸共存', () => {
  const s = S.normalizeSettings({ locked: true, size: S.percentToSize(150) })
  assert.equal(s.locked, true)
  assert.equal(s.size, S.percentToSize(150))
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

// ============ 新增：Live2D 设置 ============

test('Live2D 设置默认关闭且字段齐全', () => {
  const s = S.normalizeSettings({})
  assert.equal(s.appearance, 'image')
  assert.equal(s.live2dModel, '')
  assert.equal(s.live2dScale, 1)
  assert.equal(s.live2dOffsetX, 0)
  assert.equal(s.live2dOffsetY, 0)
  assert.equal(s.live2dMotion, true)
  assert.equal(s.live2dLookAt, true)
})

test('appearance=live2d 但没有模型 id 时回退图片模式', () => {
  const s = S.normalizeSettings({ appearance: 'live2d' })
  assert.equal(s.appearance, 'image')
  const bad = S.normalizeSettings({ appearance: 'live2d', live2dModel: '../../etc/passwd' })
  assert.equal(bad.appearance, 'image')
  assert.equal(bad.live2dModel, '')
})

test('合法的 Live2D 模型 id 才会被保留', () => {
  const s = S.normalizeSettings({ appearance: 'live2d', live2dModel: 'l2d-0123456789ab' })
  assert.equal(s.appearance, 'live2d')
  assert.equal(s.live2dModel, 'l2d-0123456789ab')
  // 图片模式下也记住选择，方便切回来
  const kept = S.normalizeSettings({ appearance: 'image', live2dModel: 'l2d-abcdef123456' })
  assert.equal(kept.appearance, 'image')
  assert.equal(kept.live2dModel, 'l2d-abcdef123456')
})

test('Live2D 缩放与偏移被夹到合理范围', () => {
  const s = S.normalizeSettings({ live2dScale: 99, live2dOffsetX: -9, live2dOffsetY: 9 })
  assert.equal(s.live2dScale, 2.5)
  assert.equal(s.live2dOffsetX, -0.5)
  assert.equal(s.live2dOffsetY, 0.5)
  assert.equal(S.normalizeSettings({ live2dScale: Number.NaN }).live2dScale, 1)
})

test('Live2D 开关只认显式 false', () => {
  assert.equal(S.normalizeSettings({ live2dMotion: false }).live2dMotion, false)
  assert.equal(S.normalizeSettings({ live2dMotion: 'false' }).live2dMotion, true)
  assert.equal(S.normalizeSettings({ live2dLookAt: false }).live2dLookAt, false)
})

// ============ 新增：Live2D 路由集成 ============

/** 造一个可被 readBody 消费的请求桩。 */
function makeReq(method, url, body) {
  if (body === undefined) return { method, url }
  const req = Readable.from([body])
  req.method = method
  req.url = url
  return req
}

const LIVE2D_MODEL_JSON = {
  Version: 3,
  FileReferences: {
    Moc: 'model.moc3',
    Textures: ['textures/tex_00.png'],
    Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] },
  },
}

function makeLive2DZip() {
  return makeZip([
    { path: 'demo/model.model3.json', data: JSON.stringify(LIVE2D_MODEL_JSON) },
    { path: 'demo/model.moc3', data: Buffer.from('MO3FAKE', 'utf8') },
    { path: 'demo/textures/tex_00.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    { path: 'demo/motions/idle.motion3.json', data: '{}' },
  ])
}

test('Live2D 无模型时列表为空', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'fishpet-l2d-'))
  try {
    const { ctx, routes } = makeCtx()
    apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500, dataDir: tmp })
    const route = routes.find(r => r.path === LIVE2D_MODELS_PATH)
    const res = makeRes()
    await route.handler(makeReq('GET', LIVE2D_MODELS_PATH), res)
    assert.equal(res.out.status, 200)
    const payload = JSON.parse(res.out.body)
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.models, [])
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('Live2D 上传 zip 后可列出、读取文件、删除并回退设置', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'fishpet-l2d-'))
  try {
    const { ctx, routes } = makeCtx()
    apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500, dataDir: tmp })
    const modelsRoute = routes.find(r => r.path === LIVE2D_MODELS_PATH)
    const fileRoute = routes.find(r => r.path === LIVE2D_MODEL_BASE)

    // 上传
    let res = makeRes()
    await modelsRoute.handler(
      makeReq('POST', `${LIVE2D_MODELS_PATH}?name=demo`, makeLive2DZip()),
      res,
    )
    assert.equal(res.out.status, 200, res.out.body)
    const uploaded = JSON.parse(res.out.body)
    assert.equal(uploaded.ok, true)
    assert.match(uploaded.model.id, /^l2d-[a-z0-9]{12}$/)
    assert.equal(uploaded.model.name, 'demo')
    assert.equal(uploaded.model.version, '4')

    // 列表
    res = makeRes()
    await modelsRoute.handler(makeReq('GET', LIVE2D_MODELS_PATH), res)
    const list = JSON.parse(res.out.body)
    assert.equal(list.models.length, 1)
    assert.equal(list.models[0].id, uploaded.model.id)
    assert.equal(list.models[0].modelJsonPath, 'demo/model.model3.json', '列表要带 modelJsonPath 供前端拼 URL')

    // 读模型文件（model3.json），路径式 URL 保证相对引用可解析
    res = makeRes()
    await fileRoute.handler(
      makeReq('GET', `${LIVE2D_MODEL_BASE}/${uploaded.model.id}/demo/model.model3.json`),
      res,
    )
    assert.equal(res.out.status, 200)
    assert.match(res.out.headers['content-type'], /application\/json/)
    assert.equal(JSON.parse(res.out.body).Version, 3)

    // 贴图用「model3.json 同目录相对路径」请求，验证路径式 URL 的关键约束
    res = makeRes()
    await fileRoute.handler(
      makeReq('GET', `${LIVE2D_MODEL_BASE}/${uploaded.model.id}/demo/textures/tex_00.png`),
      res,
    )
    assert.equal(res.out.status, 200)
    assert.match(res.out.headers['content-type'], /image\/png/)

    // 路径穿越被拒绝
    for (const evil of ['%2e%2e/meta.json', 'demo/%2e%2e/%2e%2e/meta.json', '..%5Cmeta.json']) {
      res = makeRes()
      await fileRoute.handler(
        makeReq('GET', `${LIVE2D_MODEL_BASE}/${uploaded.model.id}/${evil}`),
        res,
      )
      // URL 解析阶段会先归一化 ../，落不到路由；能落到的由 sanitizeZipPath 拒绝
      assert.ok([400, 404].includes(res.out.status), `${evil} -> ${res.out.status}`)
      if (res.out.status === 400) assert.equal(JSON.parse(res.out.body).code, 'BAD_PATH', evil)
    }
    assert.equal(res.out.status, 400)
    assert.equal(JSON.parse(res.out.body).code, 'BAD_PATH')

    // 设置里选中该模型
    const settingsRoute = routes.find(r => r.path === '/api/fish-pet/settings')
    res = makeRes()
    await settingsRoute.handler(makeReq('PUT', '/api/fish-pet/settings', Buffer.from(JSON.stringify({
      appearance: 'live2d',
      live2dModel: uploaded.model.id,
    }))), res)
    assert.equal(res.out.status, 200)
    assert.equal(JSON.parse(res.out.body).settings.appearance, 'live2d')

    // 删除后设置自动回退图片模式
    res = makeRes()
    await modelsRoute.handler(makeReq('DELETE', `${LIVE2D_MODELS_PATH}?id=${uploaded.model.id}`), res)
    const deleted = JSON.parse(res.out.body)
    assert.equal(deleted.ok, true)
    assert.deepEqual(deleted.models, [])

    res = makeRes()
    await settingsRoute.handler(makeReq('GET', '/api/fish-pet/settings'), res)
    const settings = JSON.parse(res.out.body).settings
    assert.equal(settings.appearance, 'image')
    assert.equal(settings.live2dModel, '')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('Live2D 上传非 zip 返回结构化错误', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'fishpet-l2d-'))
  try {
    const { ctx, routes } = makeCtx()
    apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500, dataDir: tmp })
    const route = routes.find(r => r.path === LIVE2D_MODELS_PATH)
    const res = makeRes()
    await route.handler(makeReq('POST', LIVE2D_MODELS_PATH, Buffer.from('not a zip at all')), res)
    assert.equal(res.out.status, 400)
    const payload = JSON.parse(res.out.body)
    assert.equal(payload.ok, false)
    assert.ok(['BAD_ARCHIVE', 'NO_MODEL_FILE'].includes(payload.code))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// Live2D 运行时依赖第三方脚本（pixi、Cubism Core），开源发行版不随仓库分发，
// 缺少资源时跳过，避免发行版测试无谓失败。
const LIVE2D_ASSETS_READY = existsSync(fileURLToPath(new URL(
  '../../plugins/dsh-plugin-fish-pet/assets/live2d/cubism4.min.js',
  import.meta.url,
))) || existsSync(fileURLToPath(new URL('../assets/live2d/cubism4.min.js', import.meta.url)))

test('Live2D 运行时脚本可按白名单读取，未知文件 404', {
  skip: LIVE2D_ASSETS_READY ? false : '未安装 Live2D 第三方运行时（发行版默认不含）',
}, async () => {
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', dataDir: TEST_DATA, timeoutMs: 500 })
  const route = routes.find(r => r.path === LIVE2D_RUNTIME_PATH)
  assert.ok(route)

  let res = makeRes()
  await route.handler(makeReq('GET', `${LIVE2D_RUNTIME_PATH}/pixi.min.js`), res)
  assert.equal(res.out.status, 200)
  assert.match(res.out.headers['content-type'], /text\/javascript/)

  res = makeRes()
  await route.handler(makeReq('GET', `${LIVE2D_RUNTIME_PATH}/../index.js`), res)
  assert.equal(res.out.status, 404)
})

// ---------- 点击音效与语音的隔离 ----------

test('clickAudioMode 只接受四个已知值', () => {
  for (const ok of ['auto', 'voice', 'sound', 'both']) {
    assert.equal(S.normalizeSettings({ clickAudioMode: ok }).clickAudioMode, ok)
  }
  for (const bad of ['hack', '', null, 123, 'AUTO']) {
    assert.equal(S.normalizeSettings({ clickAudioMode: bad }).clickAudioMode, 'auto', String(bad))
  }
  assert.equal(S.SETTINGS_DEFAULTS.clickAudioMode, 'auto', '默认必须是 auto')
})

test('音效与语音是两套独立设置，互不改写', () => {
  const onlyVoice = S.normalizeSettings({ voiceEnabled: true, voiceVolume: 0.9, soundVolume: 0.2 })
  assert.equal(onlyVoice.soundEnabled, false, '开语音不应自动开音效')
  assert.equal(onlyVoice.voiceVolume, 0.9)
  assert.equal(onlyVoice.soundVolume, 0.2, '两个音量应各自独立')

  const onlySound = S.normalizeSettings({ soundEnabled: true, soundVolume: 0.7 })
  assert.equal(onlySound.voiceEnabled, false, '开音效不应自动开语音')
  assert.equal(onlySound.voiceVolume, S.SETTINGS_DEFAULTS.voiceVolume)
})

// ============ 新增：动态形象（伪 Live2D）设置 ============

test('appearance 支持 dynamic 动态形象模式', () => {
  const s = S.normalizeSettings({ appearance: 'dynamic' })
  assert.equal(s.appearance, 'dynamic')
  assert.equal(S.normalizeSettings({ appearance: 'nope' }).appearance, 'image')
})

test('dynamicIntensity 默认 0.6 并夹到 0–1.5', () => {
  assert.equal(S.SETTINGS_DEFAULTS.dynamicIntensity, 0.6)
  assert.equal(S.normalizeSettings({}).dynamicIntensity, 0.6)
  assert.equal(S.normalizeSettings({ dynamicIntensity: 99 }).dynamicIntensity, 1.5)
  assert.equal(S.normalizeSettings({ dynamicIntensity: -3 }).dynamicIntensity, 0)
})

test('voiceLang 只接受已知值，默认 auto', () => {
  for (const ok of ['auto', 'zh', 'en', 'ja', 'ko']) {
    assert.equal(S.normalizeSettings({ voiceLang: ok }).voiceLang, ok)
  }
  for (const bad of ['xx', '', null, 1]) {
    assert.equal(S.normalizeSettings({ voiceLang: bad }).voiceLang, 'auto', String(bad))
  }
  assert.equal(S.SETTINGS_DEFAULTS.voiceLang, 'auto')
})

test('appearance 接受 animation（上游动画形象），未知值回落图片', () => {
  assert.equal(S.normalizeSettings({ appearance: 'animation' }).appearance, 'animation')
  assert.equal(S.normalizeSettings({ appearance: 'video' }).appearance, 'image')
  assert.deepEqual([...S.APPEARANCE_MODES], ['image', 'live2d', 'dynamic', 'animation'])
})

test('动画形象的两个行为开关默认开、传 false 才关', () => {
  const def = S.normalizeSettings({})
  assert.equal(def.animRandomEnabled, true)
  assert.equal(def.animClickEnabled, true)
  assert.equal(S.normalizeSettings({ animRandomEnabled: false }).animRandomEnabled, false)
  assert.equal(S.normalizeSettings({ animClickEnabled: false }).animClickEnabled, false)
})

// ==================== 桌宠动画形象（上游 webm） ====================

test('动画清单接口扫描 .data/animations/webm', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'fishpet-anim-'))
  const webmDir = join(tmp, 'animations', 'webm')
  await mkdir(webmDir, { recursive: true })
  // 用上游池子里的真实名字，少放两份 → 清单应识别 2 个、缺 104 个
  await writeFile(join(webmDir, '待机呼吸休闲.webm'), Buffer.from('not-a-real-webm'))
  await writeFile(join(webmDir, '吃白饭.webm'), Buffer.from('not-a-real-webm'))
  // 非 webm / 非法名字应被忽略
  await writeFile(join(webmDir, 'readme.txt'), Buffer.from('x'))
  await writeFile(join(webmDir, '..evil.webm'), Buffer.from('x'))
  // 白底回退版本（alpha 不可用时用），与透明版本对齐
  const matteDir = join(tmp, 'animations', 'webm-matte')
  await mkdir(matteDir, { recursive: true })
  await writeFile(join(matteDir, '待机呼吸休闲.webm'), Buffer.from('not-a-real-webm'))
  await writeFile(join(matteDir, '吃白饭.webm'), Buffer.from('not-a-real-webm'))

  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500, dataDir: tmp })
  const route = routes.find(r => r.path === ANIMATIONS_PATH)
  assert.ok(route, '缺少动画清单路由')

  const res = makeRes()
  await route.handler({ method: 'GET', url: ANIMATIONS_PATH }, res)
  assert.equal(res.out.status, 200)
  const payload = JSON.parse(res.out.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.count, 2)
  assert.deepEqual(payload.pools.idle, ['待机呼吸休闲'])
  assert.equal(payload.expected, 106)
  assert.equal(payload.missing.length, 104)
  // 两段都有白底版 → complete，客户端可在不支持 alpha 的 WebView 上改用正片叠底
  assert.equal(payload.matte.available, true)
  assert.equal(payload.matte.count, 2)
  assert.equal(payload.matte.complete, true)
  assert.equal(payload.matte.basePath, ANIMATION_MATTE_BASE_PATH)

  const matteRoute = routes.find(r => r.path === ANIMATION_MATTE_BASE_PATH)
  assert.ok(matteRoute, '缺少白底动画文件路由')
  const resMatte = makeRes()
  await matteRoute.handler({ method: 'GET', url: `${ANIMATION_MATTE_BASE_PATH}/${encodeURIComponent('吃白饭')}.webm` }, resMatte)
  assert.equal(resMatte.out.status, 200)
  assert.match(String(resMatte.out.headers['content-type']), /video\/webm/)

  // 单个动画文件：正常 200 + video/webm
  const clipRoute = routes.find(r => r.path === ANIMATION_BASE_PATH)
  assert.ok(clipRoute, '缺少动画文件路由')
  const clipPath = `${ANIMATION_BASE_PATH}/${encodeURIComponent('吃白饭')}.webm`
  const res2 = makeRes()
  await clipRoute.handler({ method: 'GET', url: clipPath }, res2)
  assert.equal(res2.out.status, 200)
  assert.match(String(res2.out.headers['content-type']), /video\/webm/)

  // 目录穿越 / 不存在的动画一律 400/404，不能读到 webm 之外的东西
  for (const bad of [
    `${ANIMATION_BASE_PATH}/${encodeURIComponent('../../etc/passwd')}.webm`,
    `${ANIMATION_BASE_PATH}/${encodeURIComponent('不存在的动画')}.webm`,
    `${ANIMATION_BASE_PATH}/readme.txt`,
  ]) {
    const res3 = makeRes()
    await clipRoute.handler({ method: 'GET', url: bad }, res3)
    assert.ok(res3.out.status === 400 || res3.out.status === 404, `${bad} 应被拒绝`)
  }

  // 非 GET/HEAD 方法一律 405
  const res4 = makeRes()
  await clipRoute.handler({ method: 'POST', url: clipPath }, res4)
  assert.equal(res4.out.status, 405)

  await rm(tmp, { recursive: true, force: true })
})

test('没有动画素材时清单返回 ok:false / NO_ASSETS', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'fishpet-anim-empty-'))
  const { ctx, routes } = makeCtx()
  apply(ctx, { ...Config(), endpoint: 'http://127.0.0.1:1/x', timeoutMs: 500, dataDir: tmp })
  const route = routes.find(r => r.path === ANIMATIONS_PATH)
  const res = makeRes()
  await route.handler({ method: 'GET', url: ANIMATIONS_PATH }, res)
  assert.equal(res.out.status, 200)
  const payload = JSON.parse(res.out.body)
  assert.equal(payload.ok, false)
  assert.equal(payload.available, false)
  assert.equal(payload.reason, 'NO_ASSETS')
  await rm(tmp, { recursive: true, force: true })
})

// 统一释放所有 ctx.effect 的定时器，否则测试进程会一直挂住
after(() => {
  for (const d of DISPOSERS) {
    try { d() } catch { /* ignore */ }
  }
  DISPOSERS.length = 0
})
