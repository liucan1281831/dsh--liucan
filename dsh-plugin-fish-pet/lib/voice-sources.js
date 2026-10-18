/**
 * 纯逻辑：桌宠语音声源（TTS）的目录、校验与请求构造。
 *
 * 与 cordis 解耦，便于离线单测。
 *
 * 设计要点：
 * - 声源是「配置数据」而不是代码，所以全部经过 normalizeVoiceSource 收紧，
 *   前端传来的东西一律当作不可信输入。
 * - 支持四类 provider：baidu / openai / template / local。
 * - 社区目录（CATALOG）只提供「怎么配」的模板，不内置任何密钥。
 *
 * @module dsh-plugin-fish-pet/lib/voice-sources
 */

/** 声源类型。 */
export const VOICE_TYPES = ['baidu', 'openai', 'azure', 'volc', 'zipvoice', 'template', 'webspeech', 'local']

/** 当前支持的语种（百度接口实测可用）。 */
export const BAIDU_LANGS = { zh: '中文', en: '英文', jp: '日文', kor: '韩文', spa: '西班牙文', fra: '法文' }

/**
 * 百度官方 TTS 的免费音色（实测只有这两个返回音频，其余需要授权）。
 * 0 = 度小美（女声，默认），106 = 度博文（男声）。
 */
/**
 * 可切换的朗读语种。
 * - auto：跟随声源自身的语种设置（默认）
 * - zh/en/ja/ko：强制用该语种朗读
 */
export const SPEECH_LANGS = ['auto', 'zh', 'en', 'ja', 'ko']

/** 语种在界面上的名称。 */
export const SPEECH_LANG_NAMES = {
  auto: '跟随声源',
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
}

/** 选中语种时 Azure 该用哪个神经音色（未指定音色时）。 */
/**
 * 各声源类型实际能念哪些语种。
 *
 * 实测：百度免费接口只有中文稳定可用，英文/日文/韩文后端经常报
 * 'Failed connect to jtts engine'；克隆模型是中文+英文双语。
 * 提前告诉用户，免得选了没声音还以为是插件坏了。
 */
export const LANG_SUPPORT = {
  baidu: ['zh', 'en'],
  zipvoice: ['zh', 'en'],
  azure: ['zh', 'en', 'ja', 'ko'],
  webspeech: ['zh', 'en', 'ja', 'ko'],
  openai: ['zh', 'en', 'ja', 'ko'],
  template: ['zh', 'en', 'ja', 'ko'],
  local: [],
}

/**
 * 检查某个声源能否朗读指定语种。
 * @param {string} type 声源类型
 * @param {string} lang 语种（auto 视为支持）
 * @returns {{ ok: boolean, supported: string[] }}
 */
export function checkLanguageSupport(type, lang) {
  const supported = LANG_SUPPORT[type] ?? []
  if (!lang || lang === 'auto') return { ok: true, supported }
  return { ok: supported.includes(lang), supported }
}

/** 通用语种 → 百度 lan 参数（注意日文是 jp、韩文是 kor）。 */
export const BAIDU_LANG_MAP = {
  zh: 'zh',
  en: 'en',
  ja: 'jp',
  ko: 'kor',
}

export const AZURE_LANG_VOICES = {
  zh: 'zh-CN-XiaoxiaoNeural',
  en: 'en-US-AriaNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
}

/** 选中语种时系统语音用的 BCP-47 标签。 */
export const WEBSpeech_LANG_TAGS = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
}

export const BAIDU_PERSONS = {
  0: '度小美（女声）',
  106: '度博文（男声）',
}

/** 单次合成的文本上限：过长会被上游拒绝，也会拖慢。 */
export const MAX_TEXT_LENGTH = 180

/**
 * 社区声源目录。
 *
 * 这些是「配置模板」，不是内置密钥。`needsKey` 为 true 的需要用户自己填。
 * 搜索时匹配 name / tags / description。
 */
export const CATALOG = [
  {
    id: 'zipvoice-clone',
    name: '声音克隆（免费·全离线·用你的声音）',
    type: 'zipvoice',
    tags: ['推荐', '免费', '克隆', '离线', '用自己的声音', '零样本'],
    languages: ['zh', 'en'],
    needsKey: false,
    description:
      '上传一段 3-20 秒的你说话的视频或音频，自动提取音频并识别文字，'
      + '之后桌宠就用你的音色朗读任意文本。基于 ZipVoice + SenseVoice，全本地运行、不联网、不需要账号。'
      + '首次使用需按 README 下载模型（约 160MB）并安装依赖。',
    homepage: 'https://github.com/k2-fsa/sherpa-onnx',
    preset: { type: 'zipvoice', refWav: '', refText: '' },
  },
  {
    id: 'webspeech-system',
    name: '手机自带语音（推荐·零网络）',
    type: 'webspeech',
    tags: ['推荐', '免费', '无需密钥', '离线', '系统音色', '最自然'],
    languages: ['zh', 'en'],
    needsKey: false,
    description:
      '直接调用手机系统安装的 TTS 引擎（通常是讯飞/华为/小米的语音包），不联网、不耗流量、音质通常明显好于免费网页接口。'
      + '部分 WebView 可能不支持，试听一次即可判断。',
    preset: { type: 'webspeech', voiceName: '', rate: 1, pitch: 1 },
  },
  {
    id: 'azure-neural',
    name: 'Azure 神经语音（晓晓等，免费额度）',
    type: 'azure',
    tags: ['高质量', '微软', '晓晓', '云希', '免费额度', '需密钥'],
    languages: ['zh', 'en', 'ja'],
    needsKey: true,
    description:
      '和 Edge 朗读同源的神经语音（晓晓/云希/晓伊等 14 个中文音色），每月 50 万字符免费额度。'
      + '在 Azure 门户创建「语音服务」后，填区域（如 eastasia）和密钥即可。',
    homepage: 'https://portal.azure.com/',
    preset: { type: 'azure', region: 'eastasia', voice: 'zh-CN-XiaoxiaoNeural', apiKey: '' },
  },
  {
    id: 'volc-doubao',
    name: '火山引擎豆包语音（免费额度）',
    type: 'volc',
    tags: ['高质量', '字节', '豆包', '免费额度', '需密钥'],
    languages: ['zh'],
    needsKey: true,
    description:
      '字节跳动的豆包语音合成，中文自然度很高，常见音色如 zh_female_cancan_mars_bigtts（灿灿）。'
      + '在火山引擎控制台开通「语音合成」后，填 AppId 与 Access Token。',
    homepage: 'https://console.volcengine.com/speech/',
    preset: { type: 'volc', appId: '', apiKey: '', voice: 'zh_female_cancan_mars_bigtts', cluster: 'volcano_tts' },
  },
  {
    id: 'baidu-free',
    name: '百度翻译（免费）',
    type: 'baidu',
    tags: ['免费', '无需密钥', '中文', '英文', '日文', '即开即用'],
    languages: ['zh', 'en', 'jp', 'kor'],
    needsKey: false,
    description: '百度官方 TTS，无需 API Key、国内稳定。免费只有「度小美」和「度博文」两个音色，听感偏机械。'
      + '有频率限制，插件已内置缓存与节流。',
    preset: { type: 'baidu', lang: 'zh', speed: 4, per: 0 },
  },
  {
    id: 'edge-proxy',
    name: 'Edge TTS 社区代理（OpenAI 兼容）',
    type: 'openai',
    tags: ['微软', '神经语音', '晓晓', '云希', '高质量', '需自建'],
    languages: ['zh', 'en', 'ja', 'ko'],
    needsKey: false,
    description:
      '社区有人用 Cloudflare Worker 把微软 Edge 的神经语音包成 OpenAI 兼容接口（/v1/audio/speech）。'
      + '直连微软端点在国内常被 403，走这种代理可用。部署后把 baseUrl 填进来即可。',
    homepage: 'https://github.com/wuhaoxiaoxian/TTS',
    preset: {
      type: 'openai',
      baseUrl: '',
      model: 'tts-1',
      voice: 'zh-CN-XiaoxiaoNeural',
      speed: 1,
    },
  },
  {
    id: 'chattts-self',
    name: 'ChatTTS（自建）',
    type: 'openai',
    tags: ['开源', '自建', '对话式', '中文'],
    languages: ['zh', 'en'],
    needsKey: false,
    description: '开源对话式 TTS，很多项目自带 OpenAI 兼容网关。把本地网关地址填进 baseUrl 即可。',
    homepage: 'https://github.com/2noise/ChatTTS',
    preset: { type: 'openai', baseUrl: 'http://127.0.0.1:9880', model: 'tts-1', voice: 'default', speed: 1 },
  },
  {
    id: 'cosyvoice-self',
    name: 'CosyVoice（自建）',
    type: 'openai',
    tags: ['开源', '自建', '阿里', '多音色'],
    languages: ['zh', 'en', 'ja', 'ko'],
    needsKey: false,
    description: '阿里开源的高质量 TTS，社区网关通常提供 OpenAI 兼容端点。',
    homepage: 'https://github.com/FunAudioLLM/CosyVoice',
    preset: { type: 'openai', baseUrl: 'http://127.0.0.1:50000', model: 'tts-1', voice: '中文女', speed: 1 },
  },
  {
    id: 'gpt-sovits-self',
    name: 'GPT-SoVITS（自建）',
    type: 'template',
    tags: ['开源', '自建', '声音克隆', '少样本'],
    languages: ['zh', 'ja', 'en'],
    needsKey: false,
    description:
      '社区流行的少样本克隆 TTS，使用 `/tts` GET 接口，参数为 text / text_lang / ref_audio_path。'
      + '下面的模板按官方 api_v2 的默认参数填，按你自己的服务改。',
    homepage: 'https://github.com/RVC-Boss/GPT-SoVITS',
    preset: {
      type: 'template',
      url: 'http://127.0.0.1:9880/tts?text={text}&text_lang={lang}&ref_audio_path=YOUR_REF.wav&prompt_lang={lang}&prompt_text=',
      method: 'GET',
      headers: {},
    },
  },
  {
    id: 'mimo-openai',
    name: '小米 MiMo（OpenAI 兼容）',
    type: 'openai',
    tags: ['商用', '需密钥', '克隆', '中文'],
    languages: ['zh'],
    needsKey: true,
    description: '小米 MiMo 提供 OpenAI 兼容的音频接口，需要 API 地址与密钥。',
    preset: { type: 'openai', baseUrl: '', model: '', voice: '', speed: 1 },
  },
  {
    id: 'local-audio',
    name: '本地音频（免合成）',
    type: 'local',
    tags: ['离线', '零网络', '自定义音频', '最快'],
    languages: [],
    needsKey: false,
    description: '直接上传一段 MP3/WAV，点击桌宠就播放它，完全不经过 TTS、不用联网。',
    preset: { type: 'local', audioUrl: '' },
  },
]

/** 声源默认值。 */
export const VOICE_SOURCE_DEFAULTS = {
  id: '',
  name: '',
  type: 'baidu',
  lang: 'zh',
  speed: 4,
  baseUrl: '',
  apiKey: '',
  model: 'tts-1',
  voice: '',
  url: '',
  method: 'GET',
  headers: {},
  audioUrl: '',
  per: 0,
  region: 'eastasia',
  appId: '',
  cluster: 'volcano_tts',
  resourceId: 'volc.service_type.10029',
  voiceName: '',
  rate: 1,
  pitch: 1,
  refWav: '',
  refText: '',
}

/** 各字段长度上限。 */
const LIMITS = { name: 40, id: 48, url: 800, key: 400, voice: 80, model: 80, headerCount: 12 }

/** 只允许 http/https，拒绝 javascript:/data:/file: 等。 */
export function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 生成本站相对路径的音效/音频地址才允许直接引用。 */
function isSameOriginPath(value) {
  return typeof value === 'string' && /^\/api\/fish-pet\/[A-Za-z0-9._?=&%-]*$/.test(value)
}

/** 清理字符串：去控制字符、限长。 */
function cleanStr(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
}

/** 生成一个稳定但不可预测的 id。 */
export function makeSourceId(seed = '') {
  const base = cleanStr(seed, 24).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '')
  const rand = Math.random().toString(36).slice(2, 8)
  return (base ? `${base}-` : 'src-') + rand
}

/**
 * 规范化单个声源。
 *
 * @param {unknown} raw - 原始输入（可能来自前端）。
 * @returns {object | null} 规范化后的声源；类型不合法时返回 null。
 */
export function normalizeVoiceSource(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = VOICE_TYPES.includes(raw.type) ? raw.type : null
  if (!type) return null

  const out = { ...VOICE_SOURCE_DEFAULTS, type }
  out.id = cleanStr(raw.id, LIMITS.id) || makeSourceId(raw.name)
  out.name = cleanStr(raw.name, LIMITS.name) || '未命名声源'

  if (type === 'baidu') {
    const lang = cleanStr(raw.lang, 8)
    out.lang = Object.prototype.hasOwnProperty.call(BAIDU_LANGS, lang) ? lang : 'zh'
    const speed = Number(raw.speed)
    // 百度接口 spd 有效区间约 1–6
    out.speed = Number.isFinite(speed) ? Math.min(6, Math.max(1, Math.round(speed))) : 4
    const per = Number(raw.per)
    out.per = Object.prototype.hasOwnProperty.call(BAIDU_PERSONS, per) ? per : 0
    return out
  }

  if (type === 'azure') {
    out.apiKey = cleanStr(raw.apiKey, LIMITS.key)
    out.region = /^[a-z0-9-]{2,32}$/.test(String(raw.region ?? '')) ? String(raw.region) : 'eastasia'
    out.voice = cleanStr(raw.voice, LIMITS.voice) || 'zh-CN-XiaoxiaoNeural'
    return out
  }

  if (type === 'volc') {
    out.appId = cleanStr(raw.appId, 64)
    out.apiKey = cleanStr(raw.apiKey, LIMITS.key)
    out.voice = cleanStr(raw.voice, LIMITS.voice) || 'zh_female_cancan_mars_bigtts'
    out.cluster = cleanStr(raw.cluster, 40) || 'volcano_tts'
    // 2.0 音色（uranus）需要 seed-tts-2.0，1.0（mars）用 volc.service_type.10029
    const rid = cleanStr(raw.resourceId, 60)
    if (rid === 'seed-tts-2.0' || rid === 'volc.service_type.10029' || rid === 'seed-icl-2.0') {
      out.resourceId = rid
    } else {
      out.resourceId = /uranus/i.test(out.voice) ? 'seed-tts-2.0' : 'volc.service_type.10029'
    }
    return out
  }

  if (type === 'zipvoice') {
    // 参考音频由宿主在 .data/clone 下管理，这里只存文件名与文本
    const wav = cleanStr(raw.refWav, 120)
    out.refWav = /^[A-Za-z0-9_.-]+$/.test(wav) ? wav : ''
    out.refText = cleanStr(raw.refText, 200)
    return out
  }

  if (type === 'webspeech') {
    out.voiceName = cleanStr(raw.voiceName, LIMITS.voice)
    const rate = Number(raw.rate)
    out.rate = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1
    const pitch = Number(raw.pitch)
    out.pitch = Number.isFinite(pitch) ? Math.min(2, Math.max(0.5, pitch)) : 1
    return out
  }

  if (type === 'openai') {
    out.baseUrl = isSafeHttpUrl(raw.baseUrl) ? cleanStr(raw.baseUrl, LIMITS.url).replace(/\/+$/, '') : ''
    out.apiKey = cleanStr(raw.apiKey, LIMITS.key)
    out.model = cleanStr(raw.model, LIMITS.model) || 'tts-1'
    out.voice = cleanStr(raw.voice, LIMITS.voice)
    const speed = Number(raw.speed)
    out.speed = Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1
    return out
  }

  if (type === 'template') {
    out.url = isSafeHttpUrl(raw.url.replace(/\{(text|lang|speed)\}/g, 'x')) ? cleanStr(raw.url, LIMITS.url) : ''
    out.method = String(raw.method).toUpperCase() === 'POST' ? 'POST' : 'GET'
    const headers = {}
    if (raw.headers && typeof raw.headers === 'object') {
      let n = 0
      for (const [k, v] of Object.entries(raw.headers)) {
        if (n >= LIMITS.headerCount) break
        // 注意：先校验「原始」头名，再清洗。
        // 若先 cleanStr 再校验，含换行的 "X-Bad\nInject" 会被洗成合法的
        // "X-BadInject" 而混进来，等于把非法输入偷偷放行。
        if (typeof k !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(k.trim())) continue
        const name = k.trim()
        const val = cleanStr(v, 300)
        if (val) { headers[name] = val; n++ }
      }
    }
    out.headers = headers
    return out
  }

  // local
  out.audioUrl = isSameOriginPath(raw.audioUrl) ? raw.audioUrl : ''
  return out
}

/**
 * 规范化声源列表。
 * @param {unknown} list
 * @param {number} [max] - 条数上限。
 * @returns {object[]}
 */
export function normalizeVoiceSources(list, max = 30) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (out.length >= max) break
    const src = normalizeVoiceSource(raw)
    if (!src) continue
    // id 去重，重复则跳过
    if (seen.has(src.id)) continue
    seen.add(src.id)
    out.push(src)
  }
  return out
}

/**
 * 判断一个声源是否「可立即使用」。
 * @param {object} source
 * @returns {{ ok: boolean, reason?: string }}
 */
export function sourceReadiness(source) {
  if (!source) return { ok: false, reason: '声源不存在' }
  if (source.type === 'baidu') return { ok: true }
  if (source.type === 'openai') {
    if (!source.baseUrl) return { ok: false, reason: '未填写 baseUrl' }
    if (!source.voice) return { ok: false, reason: '未填写 voice' }
    return { ok: true }
  }
  if (source.type === 'azure') {
    if (!source.apiKey) return { ok: false, reason: '未填写 Azure 密钥' }
    return { ok: true }
  }
  if (source.type === 'volc') {
    if (!source.appId) return { ok: false, reason: '未填写火山 AppId' }
    if (!source.apiKey) return { ok: false, reason: '未填写火山 Access Token' }
    return { ok: true }
  }
  if (source.type === 'zipvoice') {
    if (!source.refWav) return { ok: false, reason: '未上传参考音频' }
    if (!source.refText) return { ok: false, reason: '参考文本为空' }
    return { ok: true }
  }
  if (source.type === 'webspeech') return { ok: true }
  if (source.type === 'template') {
    if (!source.url) return { ok: false, reason: '未填写 URL 模板' }
    return { ok: true }
  }
  if (source.type === 'local') {
    if (!source.audioUrl) return { ok: false, reason: '未上传音频' }
    return { ok: true }
  }
  return { ok: false, reason: '未知类型' }
}

/**
 * 把模板里的占位符替换成实际值。
 * @param {string} template
 * @param {{ text: string, lang: string, speed: number }} vars
 * @returns {string}
 */
export function fillTemplate(template, vars) {
  return template
    .replace(/\{text\}/g, encodeURIComponent(vars.text))
    .replace(/\{lang\}/g, encodeURIComponent(vars.lang))
    .replace(/\{speed\}/g, String(vars.speed))
}

/**
 * 构造一次合成请求描述（不实际发请求，便于单测）。
 *
 * @param {object} source - 已规范化的声源。
 * @param {string} text - 要朗读的文本。
 * @returns {{ method: string, url: string, headers: Record<string,string>, body: string|null, expect: string }}
 * @throws {Error} 声源不可用时抛出，错误信息可直接展示给用户。
 */
export function buildSynthesisRequest(source, text, opts = {}) {
  const ready = sourceReadiness(source)
  if (!ready.ok) throw new Error(`声源不可用：${ready.reason}`)
  const input = cleanStr(text, MAX_TEXT_LENGTH)
  if (!input) throw new Error('文本为空')

  // 语种覆盖：auto 表示跟随声源自己的设置
  const rawLang = cleanStr(opts.lang, 8)
  const langOverride = SPEECH_LANGS.includes(rawLang) && rawLang !== 'auto' ? rawLang : ''

  if (source.type === 'baidu') {
    // 官方 text2audio 支持 per 音色；fanyi 的 gettts 会忽略 per，所以走官方接口
    const url = 'https://tts.baidu.com/text2audio'
      + `?tex=${encodeURIComponent(input)}`
      + `&lan=${encodeURIComponent(langOverride && BAIDU_LANG_MAP[langOverride] ? BAIDU_LANG_MAP[langOverride] : source.lang)}`
      + '&cuid=baike&ctp=1&pdt=301'
      + `&per=${source.per ?? 0}`
      + `&spd=${source.speed}`
    return {
      method: 'GET',
      url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        Referer: 'https://baike.baidu.com/',
        Accept: 'audio/mpeg,*/*',
      },
      body: null,
      expect: 'audio',
    }
  }

  if (source.type === 'azure') {
    // 选中语种时换成该语种的默认音色，否则会拿中文音色念英文
    const azureVoice = langOverride && AZURE_LANG_VOICES[langOverride]
      ? AZURE_LANG_VOICES[langOverride]
      : source.voice
    // SSML 属性必须用单引号包裹，文本里的 & < > 要转义，否则请求会被拒
    const escaped = input.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
    const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">'
      + `<voice name="${azureVoice}">${escaped}</voice></speak>`
    return {
      method: 'POST',
      url: `https://${source.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      headers: {
        'Ocp-Apim-Subscription-Key': source.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'dsh-fish-pet',
      },
      body: ssml,
      expect: 'audio',
    }
  }

  if (source.type === 'volc') {
    return {
      method: 'POST',
      url: 'https://openspeech.bytedance.com/api/v1/tts',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer;${source.apiKey}`,
      },
      body: JSON.stringify({
        app: { appid: source.appId, token: source.apiKey, cluster: source.cluster },
        user: { uid: 'dsh-fish-pet' },
        audio: { voice_type: source.voice, encoding: 'mp3', speed_ratio: 1 },
        request: { reqid: `${Date.now()}`, text: input, operation: 'query' },
        // 2.0 音色（uranus）需要根层的 resource_id，放错层级会得到空音频
        ...(source.resourceId ? { resource_id: source.resourceId } : {}),
      }),
      expect: 'json-base64',
    }
  }

  if (source.type === 'webspeech') {
    // 本地合成：不产生 HTTP 请求，由前端调用 speechSynthesis
    return {
      method: 'NONE',
      url: '',
      headers: {},
      body: null,
      expect: 'client',
      client: {
        voiceName: source.voiceName,
        rate: source.rate,
        pitch: source.pitch,
        text: input,
        lang: (langOverride && WEBSpeech_LANG_TAGS[langOverride]) || '',
      },
    }
  }

  if (source.type === 'openai') {
    const headers = { 'content-type': 'application/json', accept: 'audio/*' }
    if (source.apiKey) headers.authorization = `Bearer ${source.apiKey}`
    return {
      method: 'POST',
      url: `${source.baseUrl}/v1/audio/speech`,
      headers,
      body: JSON.stringify({
        model: source.model || 'tts-1',
        input,
        voice: source.voice,
        speed: source.speed ?? 1,
        response_format: 'mp3',
      }),
      expect: 'audio',
    }
  }

  if (source.type === 'zipvoice') {
    // 本地克隆：不产生 HTTP 请求，由宿主调用 Python 助手
    return {
      method: 'LOCAL',
      url: '',
      headers: {},
      body: null,
      expect: 'clone',
      clone: { refWav: source.refWav, refText: source.refText, text: input },
    }
  }

  if (source.type === 'template') {
    const vars = { text: input, lang: source.lang || 'zh', speed: source.speed ?? 1 }
    const url = fillTemplate(source.url, vars)
    const headers = { ...source.headers }
    if (source.method === 'POST') {
      headers['content-type'] = headers['content-type'] ?? 'application/json'
      return {
        method: 'POST',
        url,
        headers,
        body: JSON.stringify({ text: input, lang: vars.lang, speed: vars.speed }),
        expect: 'audio',
      }
    }
    return { method: 'GET', url, headers, body: null, expect: 'audio' }
  }

  throw new Error('本地音频声源不需要合成')
}

/**
 * 在社区目录里搜索声源。
 *
 * @param {string} query - 关键词（为空则返回全部）。
 * @returns {typeof CATALOG}
 */
export function searchCatalog(query) {
  const q = cleanStr(query, 60).toLowerCase()
  if (!q) return CATALOG.slice()
  const terms = q.split(/\s+/).filter(Boolean)
  return CATALOG.filter(entry => {
    const haystack = [
      entry.name,
      entry.description,
      ...(entry.tags || []),
      ...(entry.languages || []),
      entry.type,
    ].join(' ').toLowerCase()
    return terms.every(t => haystack.includes(t))
  })
}

/**
 * 把目录条目转成一个可用的声源对象。
 * @param {string} catalogId
 * @returns {object | null}
 */
export function sourceFromCatalog(catalogId) {
  const entry = CATALOG.find(e => e.id === catalogId)
  if (!entry) return null
  return normalizeVoiceSource({
    ...entry.preset,
    id: makeSourceId(entry.id),
    name: entry.name,
  })
}

/**
 * 给前端展示时隐藏密钥：只标记「已设置」，不回传明文。
 * @param {object} source
 * @returns {object}
 */
/**
 * 音色库：社区流行的具体音色（可按关键词搜索）。
 *
 * 与 CATALOG 的区别：CATALOG 是「声源（服务）」，这里是「某个服务下的某个音色」。
 * 加一个音色 = 用对应 provider 建一个带 voice 参数的新声源。
 *
 * 标签是人工维护的，不用自动推断——自动推断会把「Vivi」误标成萝莉，
 * 搜索就不可信了。
 */
import { VOICE_LIBRARY } from './voice-library.js'

// 再导出，保持外部调用方式不变
export { VOICE_LIBRARY }

/**
 * 在音色库里搜索。
 * @param {string} query
 * @returns {typeof VOICE_LIBRARY}
 */
export function searchVoiceLibrary(query) {
  const q = cleanStr(query, 60).toLowerCase()
  if (!q) return VOICE_LIBRARY.slice()
  const terms = q.split(/\s+/).filter(Boolean)
  return VOICE_LIBRARY.filter(v => {
    const hay = [v.name, v.voice, v.provider, ...(v.tags || [])].join(' ').toLowerCase()
    return terms.every(t => hay.includes(t))
  })
}

/**
 * 从音色库条目构造声源。
 * @param {string} libraryId - 形如 voice:volc:zh_female_xxx
 * @returns {object | null}
 */
export function sourceFromVoiceLibrary(libraryId) {
  const item = VOICE_LIBRARY.find(v => v.id === libraryId)
  if (!item) return null
  const base = { id: makeSourceId(item.provider), name: item.name, voice: item.voice }
  if (item.provider === 'volc') {
    return normalizeVoiceSource({ ...base, type: 'volc', resourceId: 'seed-tts-2.0' })
  }
  if (item.provider === 'azure') {
    return normalizeVoiceSource({ ...base, type: 'azure' })
  }
  return normalizeVoiceSource({ ...base, type: 'openai', baseUrl: '' })
}

export function maskVoiceSource(source) {
  if (!source) return source
  const { apiKey, ...rest } = source
  return { ...rest, hasKey: typeof apiKey === 'string' && apiKey.length > 0 }
}
