/**
 * 上游桌宠动画池：配置数据 + 纯逻辑。
 *
 * 桌宠动画素材来自上游开源项目 **PC2005-cloud/dsh-pet**（MIT）：
 * 106 个 640×360 的透明 webm（VP9-alpha），覆盖待机、点击回应、拖拽、移动、
 * 随机动作（小动作/玩耍/吃什么/时节/文字）与事件动画（余额/碎碎念/工作状态）。
 *
 * 为什么只放数据、不放素材：
 *  - 素材共 53MB，不适合塞进插件仓库；
 *  - 用户明确要求「模型自己用，不上传到 GitHub」。
 * 因此本文件只描述「有哪些动画、怎么抽」，实际 .webm 由用户放到
 * `.data/animations/webm/`（已加入 .gitignore），宿主扫描目录生成清单。
 *
 * 与 cordis 解耦，纯函数，便于离线单测。
 *
 * @module dsh-plugin-fish-pet/lib/anim-catalog
 */

/** 播放素材扩展名（与上游 ANIMATION_EXT 一致）。 */
export const ANIMATION_EXT = '.webm'

/** 素材默认相对目录（相对插件 .data）。 */
export const ANIMATION_SUBDIR = 'animations/webm'

/**
 * 白底版本素材目录。
 *
 * Android WebView / ExoPlayer 一类解码器不支持带 alpha 的 webm，
 * 透明背景会被渲染成黑色。为了在手机上也有同样的观感，宿主会额外提供
 * 「白底 + 正片叠底（mix-blend-mode: multiply）」的版本：
 * 客户端先探测 `<video>` 是否真的保留 alpha，不支持时自动切到白底版本。
 */
export const ANIMATION_MATTE_SUBDIR = 'animations/webm-matte'

/** 素材清单里最多接受的动画名长度。 */
export const MAX_CLIP_NAME = 120

/** 播放清单路由（客户端拉取用）。 */
export const ANIMATIONS_PATH = '/api/fish-pet/animations'

/** 单个动画文件路由前缀（客户端拼 `${base}/${encodeURIComponent(name)}.webm`）。 */
export const ANIMATION_BASE_PATH = '/api/fish-pet/animation'

/** 白底动画文件路由前缀（alpha 不可用时的回退）。 */
export const ANIMATION_MATTE_BASE_PATH = '/api/fish-pet/animation-matte'

/**
 * 上游 `assets/config.jsonc` 的 `animations` 段。
 *
 * 结构说明（与上游语义保持一致）：
 *  - idle/turn/drag/clicks：等概率池；
 *  - moves：移动动画，含 dist/leadSec/tailSec 等参数（本插件只播动作，不搬移动逻辑）；
 *  - categories：随机动作分类池，`weight` 是分类权重；`noMirror` 的动画带文字，镜像会颠倒；
 *  - events：不进随机链，只由事件触发（余额档位 / 碎碎念 / 工作状态）。
 */
export const ANIMATION_POOLS = {
  idle: ['待机呼吸休闲'],
  turn: ['东张西望'],
  drag: ['被鼠标拖拽悬空反馈'],
  clicks: [
    '点击回应-开心跃动',
    '点击回应-害羞惊讶',
    '点击回应-傲娇生气',
    '点击回应-挠痒咯咯笑',
    '点击回应-元气挥手',
  ],
  moves: {
    default: { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 },
    actions: [
      { name: '螃蟹走路' },
      { name: '原地漂浮踏步', params: { minDist: 40, maxDist: 120 } },
      { name: '原地左转奔跑', params: { minDist: 120, maxDist: 320, leadSec: 1.75, tailSec: 4.8 } },
    ],
  },
  categories: [
    {
      id: '小动作',
      weight: 20,
      actions: [
        '悠闲哼歌', '超大伸懒腰', '原地敲击桌面互动', '原地重力下蹲压缩', '哈欠连天',
        '原地小憩沉眠', '女仆屈膝礼仪', '被吓一跳', '小幅度原地360度旋转展示',
        '偷吃零食被抓住', '用鲸鱼尾巴拍打地面', '打瞌睡被惊醒', '照镜子', '整体换装试色',
        '轻快记录', '写代码', '摇扇纳凉', '晨间刷牙',
      ],
    },
    {
      id: '玩耍',
      weight: 20,
      actions: [
        '原地专心玩魔方', '原地蹲下玩玩具汽车', '鲸鱼吐泡泡特效', '原地跳跃抓碎头顶物品',
        '玩游戏气急败坏', '玩水枪', '小提琴演奏', '蓝鲸现世', '优雅女仆舞', '轻快摇摆舞',
        '可爱宅舞', '吹气球', '动物环绕', '放风筝', '拆礼物', '变鸽子', '扑克魔术',
        '抽陀螺', '吹笛子', '蝴蝶蜜蜂环绕头顶开花', '撸猫', '凭空生花', '骑木马',
        '三球抛接', '踢毽子', '下五子棋', '荡秋千',
      ],
    },
    {
      id: '吃什么',
      weight: 16,
      actions: [
        '吃白饭', '大口吃零食', '吃Token', '吃早餐', '吃午餐', '吃晚餐', '吃冰淇淋融化',
        '吃大闸蟹', '吃糖葫芦', '吃长寿面', '吃西瓜', '涮火锅',
      ],
    },
    {
      id: '时节',
      weight: 14,
      actions: [
        '被落叶淹没', '中秋赏月吃月饼', '堆雪人', '放烟花', '吃粽子', '吃年糕', '吃青团',
        '吃腊八粥', '吃重阳糕', '收红包', '写福字', '穿针乞巧', '舞狮头', '讨糖南瓜灯',
        '插茱萸赏菊', '放河灯', '萌化小幽灵', '装点圣诞树', '放孔明灯', '吃汤圆', '吃饺子',
      ],
    },
    {
      id: '文字',
      weight: 10,
      noMirror: true,
      actions: ['是啊，吃什么', '深度思考碎碎念'],
    },
  ],
  events: {
    // 余额档位：index = p === 100 ? 5 : floor(p / 20)
    balance: [
      '余额-钱袋满溢',
      '余额-金袋叮当',
      '余额-钱袋如常',
      '余额-数金皱眉',
      '余额-袋空如洗',
      '余额-分文不剩',
    ],
    whisper: ['碎碎念-擦桌碎碎念', '碎碎念-发呆碎碎念', '碎碎念-对屏碎碎念'],
    workStatus: [
      '工作状态-思考冒泡',
      '工作状态-忙碌点按',
      '工作状态-清点归档',
      '工作状态-原地踱步张望',
      '工作状态-雀跃庆祝',
      '工作状态-垂头叹气冒汗',
    ],
  },
}

/** 动画链顶层权重（idle / turn / move）；余量由随机分类按 weight 分摊，合计 100。 */
export const ANIMATION_WEIGHTS = { idle: 10, turn: 5, move: 5 }

/**
 * 判断动画名是否可以安全地当文件名用。
 *
 * 素材名是中文短语，允许空格与中文标点，但必须挡住路径分隔符、`..`、控制字符，
 * 避免把清单里的名字直接拼进文件路径时被目录穿越。
 *
 * @param {unknown} raw
 * @returns {string} 规范化后的名字；不合法时返回空串。
 */
export function normalizeClipName(raw) {
  if (typeof raw !== 'string') return ''
  const name = raw.trim()
  if (!name || name.length > MAX_CLIP_NAME) return ''
  if (name.startsWith('.')) return ''
  if (name.includes('..')) return ''
  if (/[/\\]/.test(name)) return ''
  // 控制字符 + 删除符
  if (/[\u0000-\u001f\u007f]/.test(name)) return ''
  return name
}

/**
 * 收集所有被池子引用到的动画名（去重，保持出现顺序）。
 * @param {typeof ANIMATION_POOLS} [pools]
 * @returns {string[]}
 */
export function collectClipNames(pools = ANIMATION_POOLS) {
  const out = new Set()
  const add = name => {
    const n = normalizeClipName(name)
    if (n) out.add(n)
  }
  for (const key of ['idle', 'turn', 'drag', 'clicks']) {
    for (const name of pools[key] ?? []) add(name)
  }
  for (const action of pools.moves?.actions ?? []) add(action?.name)
  for (const category of pools.categories ?? []) {
    for (const name of category.actions ?? []) add(name)
  }
  for (const tier of Object.values(pools.events ?? {})) {
    for (const name of tier ?? []) add(name)
  }
  return [...out]
}

/** 池子里引用的动画总数（按名字去重）。 */
export const EXPECTED_CLIP_COUNT = collectClipNames().length

/**
 * 按「本地实际有哪些素材」过滤池子。
 *
 * 缺文件的条目从池里摘掉，但保留池子本身（空池 = 该功能不可用），
 * 让客户端不必自己判空。缺哪些名字会在 manifest 的 missing 里列出。
 *
 * @param {Iterable<string>} availableNames - 本地存在的动画名。
 * @param {typeof ANIMATION_POOLS} [pools]
 * @returns {{ pools: object, missing: string[] }}
 */
export function selectAvailablePools(availableNames, pools = ANIMATION_POOLS) {
  const available = new Set(availableNames)
  const missing = []
  const keepList = list => (list ?? [])
    .map(name => normalizeClipName(name))
    .filter(name => {
      if (!name) return false
      if (available.has(name)) return true
      missing.push(name)
      return false
    })

  const next = {
    idle: keepList(pools.idle),
    turn: keepList(pools.turn),
    drag: keepList(pools.drag),
    clicks: keepList(pools.clicks),
    moves: {
      default: { ...(pools.moves?.default ?? {}) },
      actions: (pools.moves?.actions ?? [])
        .filter(action => {
          const name = normalizeClipName(action?.name)
          if (!name) return false
          if (available.has(name)) return true
          missing.push(name)
          return false
        })
        .map(action => ({ ...action, name: normalizeClipName(action.name) })),
    },
    categories: (pools.categories ?? [])
      .map(category => {
        const actions = keepList(category.actions)
        return {
          ...category,
          actions,
          weight: Number.isFinite(category.weight) ? category.weight : 0,
          noMirror: category.noMirror === true,
          // 分类里一个能播的都没有时整类摘掉，避免客户端抽到空分类
          dropped: actions.length === 0,
        }
      })
      .filter(category => !category.dropped)
      .map(({ dropped, ...rest }) => rest),
    events: Object.fromEntries(
      Object.entries(pools.events ?? {}).map(([name, tier]) => [name, keepList(tier)]),
    ),
  }

  // missing 去重但保持顺序
  return { pools: next, missing: [...new Set(missing)] }
}

/**
 * 生成给客户端的动画清单。
 *
 * @param {Iterable<string>} availableNames - 本地存在的动画名。
 * @param {{ now?: () => number }} [options]
 * @returns {object} 清单（ok:false 表示一份素材都没有，客户端应回退图片形象）。
 */
export function buildAnimationManifest(availableNames, options = {}) {
  const available = [...new Set([...availableNames].map(normalizeClipName).filter(Boolean))]
  const availableSet = new Set(available)
  const matteNames = [...new Set([...(options.matteNames ?? [])].map(normalizeClipName).filter(Boolean))]
  const matteSet = new Set(matteNames)
  const expected = EXPECTED_CLIP_COUNT
  const base = {
    ext: ANIMATION_EXT,
    basePath: ANIMATION_BASE_PATH,
    expected,
    count: available.length,
    generatedAt: new Date(options.now ? options.now() : Date.now()).toISOString(),
    // 白底版本（alpha 不可用时的回退）：只有「本地可播的每一段都有白底版」才标记 complete
    matte: {
      available: matteNames.length > 0,
      count: matteNames.length,
      complete: available.length > 0 && available.every(name => matteSet.has(name)),
      basePath: ANIMATION_MATTE_BASE_PATH,
    },
  }

  if (available.length === 0) {
    return {
      ok: false,
      available: false,
      reason: 'NO_ASSETS',
      ...base,
      pools: null,
      weights: ANIMATION_WEIGHTS,
      missing: collectClipNames(),
    }
  }

  const { pools, missing } = selectAvailablePools(available)
  const randomWeight = pools.categories.reduce((sum, c) => sum + c.weight, 0)
  const topWeight = (Number(ANIMATION_WEIGHTS.idle) || 0)
    + (Number(ANIMATION_WEIGHTS.turn) || 0)
    + (Number(ANIMATION_WEIGHTS.move) || 0)

  return {
    ok: true,
    available: true,
    ...base,
    pools,
    weights: { ...ANIMATION_WEIGHTS, random: randomWeight, total: topWeight + randomWeight },
    missing,
  }
}
