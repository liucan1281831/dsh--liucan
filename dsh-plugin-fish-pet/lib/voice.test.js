/**
 * 语音声源与 TTS 缓存的离线测试：不联网、不启动 DSH。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

const V = await import('../lib/voice-sources.js')
const T = await import('../lib/tts-cache.js')

// ---------- 目录与搜索 ----------

test('社区目录包含必备声源且结构完整', () => {
  assert.ok(V.CATALOG.length >= 5)
  for (const e of V.CATALOG) {
    assert.ok(e.id && e.name && e.type, '条目缺少必填字段')
    assert.ok(V.VOICE_TYPES.includes(e.type), '未知类型 ' + e.type)
    assert.ok(Array.isArray(e.tags))
    assert.equal(typeof e.needsKey, 'boolean')
  }
})

test('searchCatalog 支持中文关键词与多词', () => {
  assert.ok(V.searchCatalog('免费').length >= 1)
  assert.ok(V.searchCatalog('开源').length >= 2)
  assert.ok(V.searchCatalog('克隆').length >= 1)
  // 多词须同时命中；不限定类型（GPT-SoVITS 是 template）
  const both = V.searchCatalog('开源 自建')
  assert.ok(both.length >= 1)
  for (const e of both) assert.match(e.name + e.description, /开源|自建/)
  // 空查询返回全部
  assert.equal(V.searchCatalog('').length, V.CATALOG.length)
  // 无匹配返回空
  assert.equal(V.searchCatalog('这个声源一定不存在zzz').length, 0)
})

// ---------- 校验 ----------

test('isSafeHttpUrl 拒绝危险协议', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '', 'not a url']) {
    assert.equal(V.isSafeHttpUrl(bad), false, bad)
  }
  assert.equal(V.isSafeHttpUrl('https://example.com/a'), true)
  assert.equal(V.isSafeHttpUrl('http://127.0.0.1:9880'), true)
})

test('normalizeVoiceSource 夹取越界参数', () => {
  const b = V.normalizeVoiceSource({ type: 'baidu', lang: 'zh', speed: 999 })
  assert.equal(b.speed, 6)
  const b2 = V.normalizeVoiceSource({ type: 'baidu', lang: 'xx', speed: -5 })
  assert.equal(b2.lang, 'zh')   // 非法语种回落
  assert.equal(b2.speed, 1)
  const o = V.normalizeVoiceSource({ type: 'openai', baseUrl: 'https://a.com', voice: 'v', speed: 99 })
  assert.equal(o.speed, 2)
})

test('normalizeVoiceSource 丢弃危险 URL 与非法头', () => {
  const t = V.normalizeVoiceSource({
    type: 'template',
    url: 'javascript:alert(1)',
    headers: { 'X-Ok': 'fine', 'bad header': 'x', 'X-Bad\nInject': 'y' },
  })
  assert.equal(t.url, '')
  assert.deepEqual(Object.keys(t.headers), ['X-Ok'])
})

test('normalizeVoiceSource 拒绝未知类型', () => {
  assert.equal(V.normalizeVoiceSource({ type: 'hack' }), null)
  assert.equal(V.normalizeVoiceSource(null), null)
})

test('normalizeVoiceSources 去重并限制条数', () => {
  const list = [
    { id: 'a', type: 'baidu', name: 'A' },
    { id: 'a', type: 'baidu', name: '重复' },
    { id: 'b', type: 'baidu', name: 'B' },
  ]
  const out = V.normalizeVoiceSources(list)
  assert.equal(out.length, 2)
})

test('sourceReadiness 报告缺什么', () => {
  assert.equal(V.sourceReadiness({ type: 'baidu' }).ok, true)
  assert.match(V.sourceReadiness({ type: 'openai', baseUrl: '' }).reason, /baseUrl/)
  assert.match(V.sourceReadiness({ type: 'openai', baseUrl: 'https://a', voice: '' }).reason, /voice/)
  assert.match(V.sourceReadiness({ type: 'template', url: '' }).reason, /URL/)
  assert.match(V.sourceReadiness({ type: 'local', audioUrl: '' }).reason, /音频/)
})

// ---------- 请求构造 ----------

test('buildSynthesisRequest 构造百度 GET', () => {
  const src = V.sourceFromCatalog('baidu-free')
  const req = V.buildSynthesisRequest(src, '你好 世界')
  assert.equal(req.method, 'GET')
  assert.match(req.url, /tts\.baidu\.com\/text2audio/)
  assert.match(req.url, /tex=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C/) // 已编码
  assert.match(req.url, /per=0/)                                        // 默认度小美
  assert.equal(req.body, null)
  // 官方接口需要 Referer，否则返回「未授权」
  assert.ok(req.headers.Referer)
})

test('buildSynthesisRequest 构造 OpenAI 兼容 POST', () => {
  const src = V.normalizeVoiceSource({
    type: 'openai', baseUrl: 'https://api.example.com/', apiKey: 'sk-x', voice: 'zh-CN-XiaoxiaoNeural',
  })
  const req = V.buildSynthesisRequest(src, '你好')
  assert.equal(req.method, 'POST')
  assert.equal(req.url, 'https://api.example.com/v1/audio/speech') // 去掉末尾斜杠
  assert.equal(req.headers.authorization, 'Bearer sk-x')
  const body = JSON.parse(req.body)
  assert.equal(body.input, '你好')
  assert.equal(body.voice, 'zh-CN-XiaoxiaoNeural')
})

test('buildSynthesisRequest 填充模板占位符', () => {
  const src = V.normalizeVoiceSource({
    type: 'template',
    url: 'http://127.0.0.1:9880/tts?text={text}&lang={lang}&spd={speed}',
  })
  const req = V.buildSynthesisRequest(src, '测试')
  assert.match(req.url, /text=%E6%B5%8B%E8%AF%95/)
  assert.match(req.url, /lang=zh/)
  assert.match(req.url, /spd=1|spd=4/)
})

test('buildSynthesisRequest 对不可用声源抛错', () => {
  assert.throws(() => V.buildSynthesisRequest({ type: 'openai', baseUrl: '' }, 'x'), /声源不可用/)
  assert.throws(() => V.buildSynthesisRequest(V.sourceFromCatalog('baidu-free'), '   '), /文本为空/)
})

test('文本超长会被截断到上限', () => {
  const src = V.sourceFromCatalog('baidu-free')
  const req = V.buildSynthesisRequest(src, '啊'.repeat(500))
  // 从 URL 反解 text 参数，确认截断到 MAX_TEXT_LENGTH
  const text = decodeURIComponent(new URL(req.url).searchParams.get('tex'))
  assert.equal(text.length, V.MAX_TEXT_LENGTH)
})

// ---------- 密钥保护 ----------

test('maskVoiceSource 不泄漏密钥', () => {
  const masked = V.maskVoiceSource({ id: 'a', type: 'openai', apiKey: 'sk-secret-123', name: 'X' })
  assert.equal(masked.apiKey, undefined)
  assert.equal(masked.hasKey, true)
  assert.doesNotMatch(JSON.stringify(masked), /sk-secret/)
})

test('maskVoiceSource 无密钥时 hasKey 为 false', () => {
  assert.equal(V.maskVoiceSource({ id: 'a', apiKey: '' }).hasKey, false)
})

// ---------- 缓存与节流 ----------

test('cacheKey 稳定且不含密钥', () => {
  const a = T.cacheKey({ type: 'baidu', lang: 'zh', speed: 4 }, '你好')
  const b = T.cacheKey({ type: 'baidu', lang: 'zh', speed: 4 }, '你好')
  assert.equal(a, b)
  assert.equal(a.length, 24)
  assert.equal(T.cacheKey({ type: 'baidu', lang: 'zh', speed: 4 }, '再见') === a, false)
  // 换密钥不应改变缓存键
  assert.equal(
    T.cacheKey({ type: 'openai', voice: 'v', apiKey: 'k1' }, 't'),
    T.cacheKey({ type: 'openai', voice: 'v', apiKey: 'k2' }, 't'),
  )
})

test('sniffAudio 只认真实音频魔数', () => {
  assert.equal(T.sniffAudio(Buffer.from([0xff, 0xf3, 0x90, 0x00])).mime, 'audio/mpeg')
  assert.equal(T.sniffAudio(Buffer.from('ID3xxxx')).mime, 'audio/mpeg')
  assert.equal(T.sniffAudio(Buffer.from('RIFFxxxxWAVE')).mime, 'audio/wav')
  assert.equal(T.sniffAudio(Buffer.from('OggS')).mime, 'audio/ogg')
  assert.equal(T.sniffAudio(Buffer.from('{"err":502}')).ok, false)
  assert.equal(T.sniffAudio(Buffer.from('<html>')).ok, false)
})

test('describeUpstreamFailure 给出可读原因', () => {
  assert.match(T.describeUpstreamFailure(403, Buffer.alloc(0)), /403/)
  assert.match(T.describeUpstreamFailure(503, Buffer.alloc(0)), /503/)
  assert.match(T.describeUpstreamFailure(200, Buffer.from('{"err_no":502}')), /非音频/)
})

test('createThrottle 合并同键并发请求', async () => {
  const th = T.createThrottle({ minIntervalMs: 0 })
  let calls = 0
  const fn = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return 'v' }
  const [a, b, c] = await Promise.all([
    th.run('same', fn), th.run('same', fn), th.run('same', fn),
  ])
  assert.equal(calls, 1, '同键应只执行一次')
  assert.equal(a, 'v'); assert.equal(b, 'v'); assert.equal(c, 'v')
})

test('createAudioIndex 超出容量时淘汰最旧条目', () => {
  const idx = T.createAudioIndex({ capacity: 2 })
  idx.set('a', '1'); idx.set('b', '2'); idx.set('c', '3')
  assert.equal(idx.get('a'), null)
  assert.equal(idx.get('c'), '3')
  assert.equal(idx.size, 2)
})

test('缓存键区分不同音色参数（换音色必须重新合成）', () => {
  const base = { type: 'baidu', lang: 'zh', speed: 4 }
  assert.notEqual(T.cacheKey({ ...base, per: 0 }, '你好'), T.cacheKey({ ...base, per: 106 }, '你好'))
  assert.notEqual(
    T.cacheKey({ type: 'azure', voice: 'zh-CN-XiaoxiaoNeural' }, 'x'),
    T.cacheKey({ type: 'azure', voice: 'zh-CN-YunxiNeural' }, 'x'),
  )
  assert.notEqual(
    T.cacheKey({ type: 'webspeech', voiceName: 'A', rate: 1 }, 'x'),
    T.cacheKey({ type: 'webspeech', voiceName: 'A', rate: 1.5 }, 'x'),
  )
})

test('新声源类型的请求构造', () => {
  // Azure：SSML + 订阅密钥头
  const az = V.normalizeVoiceSource({ type: 'azure', apiKey: 'k', region: 'eastasia', voice: 'zh-CN-XiaoxiaoNeural' })
  const r1 = V.buildSynthesisRequest(az, 'a<b')
  assert.equal(r1.method, 'POST')
  assert.match(r1.url, /^https:\/\/eastasia\.tts\.speech\.microsoft\.com\//)
  assert.equal(r1.headers['Ocp-Apim-Subscription-Key'], 'k')
  assert.match(r1.body, /<voice name="zh-CN-XiaoxiaoNeural">/)
  assert.match(r1.body, /a&lt;b/, 'SSML 特殊字符需转义')

  // 火山：JSON + Bearer 头
  const volc = V.normalizeVoiceSource({ type: 'volc', appId: 'app', apiKey: 'tok' })
  const r2 = V.buildSynthesisRequest(volc, '你好')
  assert.equal(r2.expect, 'json-base64')
  assert.equal(r2.headers.Authorization, 'Bearer;tok')
  assert.equal(JSON.parse(r2.body).app.appid, 'app')

  // 手机自带语音：不产生网络请求
  const ws = V.normalizeVoiceSource({ type: 'webspeech', rate: 1.2 })
  const r3 = V.buildSynthesisRequest(ws, '你好')
  assert.equal(r3.expect, 'client')
  assert.equal(r3.client.rate, 1.2)
})

test('新声源的可用性检查', () => {
  assert.match(V.sourceReadiness({ type: 'azure', apiKey: '' }).reason, /Azure/)
  assert.match(V.sourceReadiness({ type: 'volc', appId: '' }).reason, /AppId/)
  assert.match(V.sourceReadiness({ type: 'volc', appId: 'a', apiKey: '' }).reason, /Token/)
  assert.equal(V.sourceReadiness({ type: 'webspeech' }).ok, true)
})

test('百度音色 per 只接受已知值', () => {
  assert.equal(V.normalizeVoiceSource({ type: 'baidu', per: 106 }).per, 106)
  assert.equal(V.normalizeVoiceSource({ type: 'baidu', per: 9999 }).per, 0)
})

// ---------- 音色库 ----------
//
// 音色库是可选内容：开源发行版默认留空（音色列表属于各服务商）。
// 有数据时验证内容质量，没数据时验证「空库不会出错」。

const LIB = V.VOICE_LIBRARY
const emptyLib = LIB.length === 0
const skipIfEmpty = emptyLib ? '发行版默认不含社区音色库' : false

test('音色库条目结构完整且标签已人工指定', { skip: skipIfEmpty }, () => {
  assert.ok(LIB.length >= 20)
  for (const v of LIB) {
    assert.ok(v.id.startsWith('voice:'), 'id 需带 voice: 前缀')
    assert.ok(v.name && v.provider && v.voice)
    assert.ok(Array.isArray(v.tags) && v.tags.length > 0, '缺少标签: ' + v.name)
  }
})

test('音色库按中文关键词可搜到', { skip: skipIfEmpty }, () => {
  assert.ok(V.searchVoiceLibrary('御姐').length >= 2)
  assert.ok(V.searchVoiceLibrary('萝莉').length >= 1)
  assert.ok(V.searchVoiceLibrary('童声').length >= 1)
  assert.ok(V.searchVoiceLibrary('旁白').length >= 2)
  const male = V.searchVoiceLibrary('男声')
  assert.ok(male.length >= 3)
  for (const v of male) assert.ok(v.tags.includes('男声'))
})

test('音色库多词搜索需同时命中', { skip: skipIfEmpty }, () => {
  const r = V.searchVoiceLibrary('男声 旁白')
  assert.ok(r.length >= 1)
  for (const v of r) {
    assert.ok(v.tags.includes('男声'))
    assert.ok(v.tags.includes('旁白'))
  }
})

test('音色库空查询返回全部、无匹配返回空', () => {
  assert.equal(V.searchVoiceLibrary('').length, LIB.length)
  assert.equal(V.searchVoiceLibrary('不存在的音色zzz').length, 0)
})

test('从音色库构造声源时自动推断 resourceId', { skip: skipIfEmpty }, () => {
  const uranus = V.sourceFromVoiceLibrary('voice:volc:zh_female_gaolengyujie_uranus_bigtts')
  assert.equal(uranus.type, 'volc')
  assert.equal(uranus.resourceId, 'seed-tts-2.0', '2.0 音色需 seed-tts-2.0')

  const azure = V.sourceFromVoiceLibrary('voice:azure:zh-CN-XiaoxiaoNeural')
  assert.equal(azure.type, 'azure')

  assert.equal(V.sourceFromVoiceLibrary('voice:volc:不存在'), null)
})

test('未知音色 id 恒返回 null（与库是否为空无关）', () => {
  assert.equal(V.sourceFromVoiceLibrary('voice:volc:nope'), null)
  assert.equal(V.sourceFromVoiceLibrary(''), null)
  assert.equal(V.sourceFromVoiceLibrary('baidu-free'), null, '非 voice: 前缀应返回 null')
})

test('火山 2.0 与 1.0 音色的 resourceId 不同', () => {
  const v2 = V.normalizeVoiceSource({ type: 'volc', voice: 'zh_female_gaolengyujie_uranus_bigtts' })
  const v1 = V.normalizeVoiceSource({ type: 'volc', voice: 'zh_male_beijingxiaoye_mars_bigtts' })
  assert.equal(v2.resourceId, 'seed-tts-2.0')
  assert.equal(v1.resourceId, 'volc.service_type.10029')
  // resource_id 必须在请求体根层
  v2.appId = 'a'; v2.apiKey = 't'
  const body = JSON.parse(V.buildSynthesisRequest(v2, 'x').body)
  assert.equal(body.resource_id, 'seed-tts-2.0')
  assert.equal(body.audio.resource_id, undefined, 'resource_id 不能放在 audio 里')
})

test('克隆声源的缓存键包含参考音频（换参考必须重新合成）', () => {
  const a = T.cacheKey({ type: 'zipvoice', refWav: 'ref-a.wav', refText: 'x' }, '你好')
  const b = T.cacheKey({ type: 'zipvoice', refWav: 'ref-b.wav', refText: 'x' }, '你好')
  assert.notEqual(a, b, '不同参考音频不能共用缓存，否则换声音没效果')
  // 同一参考音频应稳定
  assert.equal(a, T.cacheKey({ type: 'zipvoice', refWav: 'ref-a.wav', refText: 'x' }, '你好'))
})

// ---------- 语种切换 ----------

test('支持五个语种，且各有显示名', () => {
  assert.deepEqual(V.SPEECH_LANGS, ['auto', 'zh', 'en', 'ja', 'ko'])
  for (const l of V.SPEECH_LANGS) assert.ok(V.SPEECH_LANG_NAMES[l], '缺少显示名: ' + l)
})

test('百度声源按语种切换 lan 参数', () => {
  const s = V.normalizeVoiceSource({ type: 'baidu', lang: 'zh', speed: 4 })
  const pick = req => new URL(req.url).searchParams.get('lan')
  assert.equal(pick(V.buildSynthesisRequest(s, 'hi')), 'zh')
  assert.equal(pick(V.buildSynthesisRequest(s, 'hi', { lang: 'en' })), 'en')
  assert.equal(pick(V.buildSynthesisRequest(s, 'hi', { lang: 'auto' })), 'zh', 'auto 应跟随声源')
  assert.equal(pick(V.buildSynthesisRequest(s, 'hi', { lang: 'xx' })), 'zh', '非法语种应忽略')
})

test('Azure 声源切换语种会换对应音色', () => {
  const s = V.normalizeVoiceSource({ type: 'azure', apiKey: 'k', voice: 'zh-CN-XiaoxiaoNeural' })
  const voiceOf = req => req.body.match(/<voice name="([^"]+)">/)[1]
  assert.equal(voiceOf(V.buildSynthesisRequest(s, 'x')), 'zh-CN-XiaoxiaoNeural')
  assert.equal(voiceOf(V.buildSynthesisRequest(s, 'x', { lang: 'en' })), 'en-US-AriaNeural')
  assert.equal(voiceOf(V.buildSynthesisRequest(s, 'x', { lang: 'ja' })), 'ja-JP-NanamiNeural')
  assert.equal(voiceOf(V.buildSynthesisRequest(s, 'x', { lang: 'ko' })), 'ko-KR-SunHiNeural')
})

test('系统语音切换语种会带 BCP-47 标签', () => {
  const s = V.normalizeVoiceSource({ type: 'webspeech' })
  assert.equal(V.buildSynthesisRequest(s, 'x', { lang: 'en' }).client.lang, 'en-US')
  assert.equal(V.buildSynthesisRequest(s, 'x', { lang: 'ja' }).client.lang, 'ja-JP')
  assert.equal(V.buildSynthesisRequest(s, 'x').client.lang, '')
})

test('语种参与缓存键：换语种必须重新合成', () => {
  const s = { type: 'baidu', lang: 'zh' }
  assert.notEqual(T.cacheKey(s, '你好', 'en'), T.cacheKey(s, '你好', 'zh'))
  assert.notEqual(T.cacheKey(s, '你好', 'auto'), T.cacheKey(s, '你好', 'zh'))
})

test('百度语种代号映射（日文 jp、韩文 kor）', () => {
  const s = V.normalizeVoiceSource({ type: 'baidu', lang: 'zh' })
  const pick = l => new URL(V.buildSynthesisRequest(s, 'hi', { lang: l }).url).searchParams.get('lan')
  assert.equal(pick('zh'), 'zh')
  assert.equal(pick('en'), 'en')
  assert.equal(pick('ja'), 'jp', '百度用 jp 不是 ja')
  assert.equal(pick('ko'), 'kor', '百度用 kor 不是 ko')
  assert.equal(pick('auto'), 'zh')
})
