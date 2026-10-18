window.__ModuleLoader__.load({
  id: 'dsh-plugin-fish-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'fish-pet'

    // ==================== 常量 ====================

    /** 宿主端端点（与 index.js 保持一致）。 */
    const PATHS = {
      balance: '/api/fish-pet/balance',
      image: '/api/fish-pet/image',
      weather: '/api/fish-pet/weather',
      settings: '/api/fish-pet/settings',
      customImage: '/api/fish-pet/custom-image',
      sound: '/api/fish-pet/sound',
      soundStatus: '/api/fish-pet/sound-status',
      voices: '/api/fish-pet/voices',
      catalog: '/api/fish-pet/voices/catalog',
      speak: '/api/fish-pet/speak',
      live2dModels: '/api/fish-pet/live2d/models',
      live2dModelBase: '/api/fish-pet/live2d/model',
      live2dRuntime: '/api/fish-pet/live2d/runtime',
      animations: '/api/fish-pet/animations',
      animationBase: '/api/fish-pet/animation',
      animationMatteBase: '/api/fish-pet/animation-matte',
      clientError: '/api/fish-pet/client-error',
      harvest: '/api/fish-pet/harvest',
      harvestAudio: '/api/fish-pet/harvest/audio',
      power: '/api/fish-pet/power',
    }

    /** 位置与显隐的持久化键（本地 UI 状态，与宿主设置分开）。 */
    const STORAGE_KEY = 'dsh.fishpet.v3'
    /** 默认贴右上角。 */
    const DEFAULT_POS = { right: 16, top: 64 }
    /** 余额轮询间隔。 */
    const BALANCE_POLL_MS = 60000
    /** 天气轮询间隔（后端另有缓存）。 */
    const WEATHER_POLL_MS = 600000
    /** 长按判定阈值（毫秒）与位移容差（像素）。 */
    const LONG_PRESS_MS = 500
    const MOVE_TOLERANCE = 8

    /** 缩放的基准高度与允许比例（与宿主 lib/pet-settings.js 保持一致）。 */
    const SIZE_BASE = 76
    const SCALE_MIN_PERCENT = 50
    const SCALE_MAX_PERCENT = 260

    /** 上游播放画布尺寸（640×360）。 */
    const ANIM_VIDEO_WIDTH = 640
    const ANIM_VIDEO_HEIGHT = 360
    /**
     * 人物在 640×360 画布里的常规占位（来自上游桌面版 manifest 的 body_box，
     * 并按待机/点击/拖拽等常用动作的实测 alpha 包围盒微调）。
     *
     * 卡片和点击热区只包这一块，所以桌宠能真正「贴边」；
     * 烟花、落叶这类大特效会超出这个框，但视频是透明背景，
     * 超出的部分照常显示，只是不算进点击区域。
     */
    const ANIM_CHAR_BOX = { x: 196, y: 60, w: 240, h: 270 }
    /**
     * 画布宽度 = size × 这个倍率。
     *
     * 可见人物高度 = 270 / 640 × 画布宽，取 2.37 后「可见人物高度 ≈ size」，
     * 与图片/Live2D 模式的 size 语义对齐（size 就是桌宠多大）。
     */
    const ANIM_SIZE_FACTOR = 2.37
    /** 动画画布宽度夹取范围（px）。 */
    const ANIM_SIZE_LIMITS = [110, 640]
    /** 随机小动作的间隔范围（毫秒）。 */
    const ANIM_RANDOM_MIN_MS = 12000
    const ANIM_RANDOM_MAX_MS = 28000

    /**
     * 桌宠高度 → 缩放百分比。
     * @param {number} size
     * @returns {number}
     */
    function sizeToPercent(size) {
      const n = Number(size)
      if (!Number.isFinite(n) || n <= 0) return 100
      return Math.round((n / SIZE_BASE) * 100)
    }

    /**
     * 缩放百分比 → 桌宠高度，夹到允许范围内。
     * @param {number} percent
     * @returns {number}
     */
    function percentToSize(percent) {
      const n = Number(percent)
      const safe = Number.isFinite(n) ? n : 100
      const min = Math.round(SIZE_BASE * SCALE_MIN_PERCENT / 100)
      const max = Math.round(SIZE_BASE * SCALE_MAX_PERCENT / 100)
      return Math.min(max, Math.max(min, Math.round((safe / 100) * SIZE_BASE)))
    }
    /** 样式表 id。 */
    const STYLE_ID = 'dsh-fishpet-style'

    /** 内置短语（与宿主 DEFAULT_PHRASES 一致）。 */
    const DEFAULT_PHRASES = [
      '大肥鱼才不是吃白饭的！(｀・ω・´)',
      '摸摸头…人家会努力的啦～ (´,,•ω•,,)',
      '不要再戳啦，好痒的～ (＞﹏＜)',
      '主人今天也辛苦了呢 (*˘︶˘*)',
      '余额还够哦，放心用吧！(๑•̀ㅂ•́)و✧',
      '我不是大肥鱼…我只是有点圆 (｡•́︿•̀｡)',
      '要记得休息呀，眼睛会累的 (｡･ω･｡)',
      '今天也要加油哦！(ง •̀_•́)ง',
    ]

    /** 设置默认值（与宿主 SETTINGS_DEFAULTS 一致）。 */
    const SETTINGS_DEFAULTS = {
      size: 76,
      opacity: 0.92,
      useCustomImage: false,
      customImageUrl: '',
      appearance: 'image',
      live2dModel: '',
      live2dScale: 1,
      live2dOffsetX: 0,
      live2dOffsetY: 0,
      live2dMotion: true,
      live2dLookAt: true,
      dynamicIntensity: 0.6,
      animRandomEnabled: true,
      animClickEnabled: true,
      phrases: [],
      soundEnabled: false,
      soundVolume: 0.5,
      soundUrl: '',
      // 点击时语音与音效的关系：auto（语音优先）/ voice / sound / both
      clickAudioMode: 'auto',
      // 朗读语种：auto 跟随声源，或强制 zh/en/ja/ko
      voiceLang: 'auto',
      weatherEnabled: true,
      weatherCity: '北京',
      shortcut: 'ctrl+shift+p',
      locked: false,
      voiceEnabled: false,
      voiceVolume: 0.8,
      speakOnClick: true,
      greetOnLoad: false,
      greetings: [],
      // 总开关（与服务端 petEnabled 对齐）：关掉后桌宠隐藏、语音与每日校准暂停
      petEnabled: true,
      // 每日声源校准
      harvestEnabled: true,
      harvestAt: '10:00',
      harvestKeywords: '大肥鱼 唱歌, 大肥鱼 音频, 肥鱼 唱歌, 大肥鱼 献唱, 大肥鱼 deepseek',
      harvestBudgetMin: 20,
      harvestMinSim: 0.65,
      harvestAutoAdd: true,
      harvestAnchor: '',
    }

    /** 天气图标：内置 emoji，无需联网下载素材。 */
    const WEATHER_ICONS = {
      clear: { day: '☀️', night: '🌙' },
      'mostly-clear': { day: '🌤️', night: '🌙' },
      'partly-cloudy': { day: '⛅', night: '☁️' },
      overcast: { day: '☁️', night: '☁️' },
      fog: { day: '🌫️', night: '🌫️' },
      drizzle: { day: '🌦️', night: '🌧️' },
      rain: { day: '🌧️', night: '🌧️' },
      snow: { day: '🌨️', night: '🌨️' },
      showers: { day: '🌦️', night: '🌧️' },
      'snow-showers': { day: '🌨️', night: '🌨️' },
      thunder: { day: '⛈️', night: '⛈️' },
      unknown: { day: '🌡️', night: '🌡️' },
    }

    // ==================== 文案 ====================

    const zh = {
      'pet.aria': '余额小鱼桌宠',
      'pet.tip': '点击摸摸 · 长按菜单 · 拖动移动 · 双指捏合缩放',
      'pet.loading': '查询中…',
      'pet.noKey': '未配置密钥',
      'pet.error': '查询失败',
      'pet.hide': '隐藏桌宠',
      'pet.show': '显示桌宠',
      'phase.peak': '高峰',
      'phase.idle': '空闲',
      'burn.left': '约剩 {time}',
      'menu.title': '桌宠菜单',
      'menu.hidePet': '隐藏',
      'menu.close': '关闭菜单',
      'menu.appearance': '外观',
      'menu.size': '大小',
      'menu.scale': '缩放',
      'menu.scale.hint': '手机上直接双指捏合桌宠即可缩放，也可以拖左下角把手或在这里调整',
      'menu.lock': '锁定',
      'menu.locked': '已锁定',
      'menu.locked.hint': '锁定后桌宠位置固定，无法拖动',
      'menu.unlock': '解锁',
      'menu.unlocked.hint': '已解锁，可以拖动',
      'menu.opacity': '背景透明度',
      'menu.image': '更换形象',
      'menu.image.builtin': '使用内置形象',
      'menu.image.upload': '上传图片 / GIF',
      'menu.image.hint': '支持 PNG / JPG / GIF / WebP，≤8MB',
      'menu.dynamic': '动态形象（伪 Live2D）',
      'menu.dynamic.enable': '让当前形象动起来',
      'menu.dynamic.hint': '把当前图片做成会呼吸、会摆动、看指针的 2.5D 动画；不是真正的 Cubism 模型，但任意图片都能用',
      'menu.dynamic.intensity': '动态幅度',
      'menu.dynamic.loading': '动态形象加载中…',
      'menu.dynamic.failed': '动态形象失败，已回退图片',
      'menu.anim': '动画形象（上游素材）',
      'menu.anim.enable': '使用动画形象',
      'menu.anim.hint': '上游 dsh-pet 的透明动画（待机呼吸 / 随机小动作 / 点击回应）；素材放 .data/animations/webm，不进仓库',
      'menu.anim.assets': '素材状态',
      'menu.anim.loading': '读取素材清单…',
      'menu.anim.ready': '已找到 {count}/{expected} 个动画',
      'menu.anim.missing': '没找到动画素材：把上游 webm 放进 .data/animations/webm/ 后刷新页面',
      'menu.anim.random': '随机小动作',
      'menu.anim.random.hint': '隔一会儿自己玩一会儿（玩耍 / 吃什么 / 时节 等分类按上游权重抽）',
      'menu.anim.click': '点击回应',
      'menu.anim.click.hint': '摸摸时随机播一段「点击回应」，与上游一致',
      'menu.anim.failed': '动画素材未安装，已回退图片',
      'menu.anim.none': '未安装',
      'menu.live2d': 'Live2D 模型',
      'menu.live2d.enable': '使用 Live2D 形象',
      'menu.live2d.hint': '需要 WebGL；加载失败会自动回退到图片形象',
      'menu.live2d.models': '已上传模型',
      'menu.live2d.empty': '还没有模型，先上传一个 zip 吧',
      'menu.live2d.upload': '上传模型压缩包',
      'menu.live2d.uploadHint': 'Cubism 3/4：model3.json + moc3 + 贴图，zip ≤48MB',
      'menu.live2d.uploading': '模型上传中…',
      'menu.live2d.uploaded': '模型已上传',
      'menu.live2d.use': '使用',
      'menu.live2d.inUse': '使用中',
      'menu.live2d.del': '删除',
      'menu.live2d.deleteConfirm': '确定删除模型「{name}」？',
      'menu.live2d.deleted': '模型已删除',
      'menu.live2d.scale': '模型缩放',
      'menu.live2d.offsetX': '水平偏移',
      'menu.live2d.offsetY': '垂直偏移',
      'menu.live2d.motion': '待机与点击动作',
      'menu.live2d.lookAt': '视线跟随指针',
      'menu.live2d.loading': 'Live2D 加载中…',
      'menu.live2d.failed': 'Live2D 加载失败，已回退图片',
      'menu.live2d.selectFirst': '先选择或上传一个模型',
      'menu.live2d.meta': 'Cubism {version} · {size} · {motions} 组动作',
      'menu.live2d.noWebgl': '当前 WebView 不支持 WebGL，无法渲染 Live2D',
      'menu.sound': '点击音效',
      'menu.sound.enable': '启用音效',
      'menu.sound.upload': '上传音效',
      'menu.sound.hint': '支持 MP3 / WAV / OGG，≤2MB',
      'menu.sound.volume': '音量',
      'menu.sound.current': '当前音效',
      'menu.sound.builtin': '内置合成音',
      'menu.sound.builtin.hint': '未上传自定义音效时，使用插件现场合成的「啵」声',
      'menu.sound.custom': '自定义音效',
      'menu.sound.custom.meta': '{type} · {size}',
      'menu.sound.try': '试听',
      'menu.sound.remove': '移除，改回内置音',
      'menu.sound.removed': '已移除自定义音效',
      'menu.sound.off': '音效已关闭，点击不会出声',
      'menu.phrases': '摸摸短语',
      'menu.phrases.hint': '每行一句，留空则用内置撒娇语',
      'menu.phrases.placeholder': '大肥鱼才不是吃白饭的！(｀・ω・´)',
      'menu.weather': '天气',
      'menu.weather.enable': '显示天气',
      'menu.weather.city': '城市',
      'menu.voice': '语音',
      'menu.voice.enable': '启用语音',
      'menu.voice.hint': '开启后，点击桌宠会用声源朗读短语',
      'menu.voice.volume': '语音音量',
      'menu.voice.onClick': '点击时朗读',
      'menu.voice.greet': '打开页面时问候',
      'menu.voice.sources': '声源',
      'menu.voice.current': '当前',
      'menu.voice.none': '还没有声源，可从下方社区目录添加',
      'menu.voice.empty': '暂无声源',
      'menu.voice.use': '使用',
      'menu.voice.edit': '编辑',
      'menu.voice.del': '删除',
      'menu.voice.preview': '试听',
      'menu.voice.working': '合成中…',
      'menu.voice.catalog': '社区声源（可搜索）',
      'menu.voice.search': '搜索',
      'menu.voice.searchPlaceholder': '试试：免费 / 开源 / 克隆 / 中文',
      'menu.voice.noMatch': '没有匹配的声源',
      'menu.voice.needsKey': '需密钥',
      'menu.voice.add': '添加',
      'menu.voice.addCustom': '+ 添加自定义声源',
      'menu.voice.editorTitle': '声源配置',
      'menu.voice.type': '类型',
      'menu.voice.name': '名称',
      'menu.voice.lang': '语种',
      'menu.voice.speed': '语速',
      'menu.voice.langWarn': '当前声源只支持中文/英文，念日文或韩文请改用「手机自带语音」或 Azure',
      'menu.voice.lang2': '朗读语种',
      'menu.voice.lang2Hint': '「跟随声源」用声源自己的语言；切换后可念英文/日文/韩文',
      'menu.voice.langAuto': '跟随声源',
      'menu.voice.clickMode': '点击音频',
      'menu.voice.clickModeHint': '默认语音优先，两者不叠音；选「两个都播」才会同时响',
      'menu.voice.modeAuto': '自动（语音优先）',
      'menu.voice.modeVoice': '只用语音',
      'menu.voice.modeSound': '只用音效',
      'menu.voice.modeBoth': '两个都播',
      'menu.voice.library': '音色库（社区音色）',
      'menu.voice.libraryHint': '搜索「御姐」「萝莉」「男声」「旁白」等关键词，点添加即用',
      'menu.voice.person': '音色',
      'menu.voice.region': '区域',
      'menu.voice.voiceName': '音色名称',
      'menu.voice.voiceNameHint': '留空=系统默认',
      'menu.voice.keySaved': '已保存，留空不修改',
      'menu.voice.webspeechHint': '使用手机系统语音，零网络。若试听无声，说明当前 WebView 不支持。',
      'menu.voice.apiKey': 'API 密钥',
      'menu.voice.placeholderHint': '模板占位符：{text} 文本、{lang} 语种、{speed} 语速',
      'menu.voice.cancel': '取消',
      'menu.voice.save': '保存',
      'menu.harvest': '每日声源校准',
      'menu.harvest.enable': '启用每日校准',
      'menu.harvest.hint': '每天到点在后台搜「大肥鱼」音频，只保留和基准音色相似度达标、且能识别出文字的片段',
      'menu.harvest.at': '每天几点后跑',
      'menu.harvest.keywords': '搜索关键词',
      'menu.harvest.keywordsHint': '逗号分隔，最多 8 条',
      'menu.harvest.budget': '时间预算',
      'menu.harvest.minSim': '相似度阈值',
      'menu.harvest.minSimHint': '低于阈值的片段直接丢弃，避免别的视频污染声源',
      'menu.harvest.autoAdd': '自动加成新声源',
      'menu.harvest.autoAddHint': '只会新增独立声源，不会改动当前/基准声源',
      'menu.harvest.anchor': '基准音色',
      'menu.harvest.anchorHint': '填 BV 号或 B 站链接，从那个视频重新抽一段基准音频',
      'menu.harvest.anchorSet': '设为基准',
      'menu.harvest.anchorUsing': '当前基准：{name}',
      'menu.harvest.anchorVoice': '跟随当前声源',
      'menu.harvest.anchorCustom': '来自视频',
      'menu.harvest.anchorNone': '还没有基准：先添加一个本地克隆声源，或填视频设置基准',
      'menu.harvest.run': '立即跑一次',
      'menu.harvest.running': '校准中… 已跑 {time}',
      'menu.harvest.lastRun': '上次：{when}',
      'menu.harvest.never': '还没跑过',
      'menu.harvest.result': '结果',
      'menu.harvest.noResult': '暂无结果',
      'menu.harvest.notify': '校准完成后会在桌宠旁弹提醒，并带「关闭肥鱼」按钮',
      'menu.harvest.minutes': '{n} 分钟',
      'menu.harvest.runningHint': '后台跑着，可以先关掉菜单',
      'harvest.title': '每日校准',
      'harvest.running': '正在校准声源…',
      'harvest.closeFish': '关闭肥鱼',
      'harvest.gotIt': '知道了',
      'harvest.detail': '详情',
      'harvest.hideDetail': '收起',
      'kill.confirm': '关闭肥鱼？桌宠会隐藏，语音与每日校准都会暂停。',
      'kill.restore': '打开肥鱼',
      'menu.shortcut': '快捷键',
      'menu.shortcut.hint': '按 Ctrl+Shift+P 呼出菜单（双击桌宠也可）',
      'menu.shortcut.invalid': '格式无效，例如 ctrl+shift+p',
      'menu.reset': '恢复默认',
      'menu.save': '保存',
      'menu.saved': '已保存',
      'menu.saving': '保存中…',
      'menu.uploading': '上传中…',
      'menu.upload.fail': '失败',
      'menu.switch': '切换',
      'menu.current': '当前',
      'menu.pick': '选择文件',
      'setting.title': '余额桌宠',
      'setting.desc': '在界面右上角显示小鱼桌宠，实时展示 DeepSeek 余额与天气。长按桌宠可打开完整菜单。',
    }

    const en = {
      'pet.aria': 'Balance pet',
      'pet.tip': 'Tap to pet · Long-press menu · Drag to move · Pinch to scale',
      'pet.loading': 'Loading…',
      'pet.noKey': 'No API key',
      'pet.error': 'Failed',
      'pet.hide': 'Hide pet',
      'pet.show': 'Show pet',
      'phase.peak': 'Peak',
      'phase.idle': 'Idle',
      'burn.left': '~{time} left',
      'menu.title': 'Pet Menu',
      'menu.hidePet': 'Hide',
      'menu.close': 'Close menu',
      'menu.appearance': 'Appearance',
      'menu.size': 'Size',
      'menu.scale': 'Scale',
      'menu.scale.hint': 'Pinch the pet on a phone, or drag the bottom-left handle, or set a percentage here',
      'menu.lock': 'Lock',
      'menu.locked': 'Locked',
      'menu.locked.hint': 'The pet stays put and cannot be dragged while locked',
      'menu.unlock': 'Unlock',
      'menu.unlocked.hint': 'Unlocked — you can drag the pet',
      'menu.opacity': 'Background opacity',
      'menu.image': 'Image',
      'menu.image.builtin': 'Use built-in image',
      'menu.image.upload': 'Upload image / GIF',
      'menu.image.hint': 'PNG / JPG / GIF / WebP, ≤8MB',
      'menu.sound': 'Click sound',
      'menu.sound.enable': 'Enable sound',
      'menu.sound.upload': 'Upload sound',
      'menu.sound.hint': 'MP3 / WAV / OGG, ≤2MB',
      'menu.sound.volume': 'Volume',
      'menu.sound.current': 'Current sound',
      'menu.sound.builtin': 'Built-in synth',
      'menu.sound.builtin.hint': 'A synthesized "pop" is used until you upload your own sound',
      'menu.sound.custom': 'Custom sound',
      'menu.sound.custom.meta': '{type} · {size}',
      'menu.sound.try': 'Test',
      'menu.sound.remove': 'Remove, use built-in',
      'menu.sound.removed': 'Custom sound removed',
      'menu.sound.off': 'Sound is off — clicking stays silent',
      'menu.phrases': 'Pet phrases',
      'menu.phrases.hint': 'One per line; empty uses built-in phrases',
      'menu.phrases.placeholder': "I'm not a big fat fish!",
      'menu.weather': 'Weather',
      'menu.weather.enable': 'Show weather',
      'menu.weather.city': 'City',
      'menu.voice': 'Voice',
      'menu.voice.enable': 'Enable voice',
      'menu.voice.hint': 'Speak the phrase when the pet is tapped',
      'menu.voice.volume': 'Voice volume',
      'menu.voice.onClick': 'Speak on tap',
      'menu.voice.greet': 'Greet on load',
      'menu.voice.sources': 'Voice sources',
      'menu.voice.current': 'Current',
      'menu.voice.none': 'No voice source yet — add one from the catalog below',
      'menu.voice.empty': 'No sources',
      'menu.voice.use': 'Use',
      'menu.voice.edit': 'Edit',
      'menu.voice.del': 'Delete',
      'menu.voice.preview': 'Preview',
      'menu.voice.working': 'Synthesizing…',
      'menu.voice.catalog': 'Community sources (searchable)',
      'menu.voice.search': 'Search',
      'menu.voice.searchPlaceholder': 'Try: free / open source / clone',
      'menu.voice.noMatch': 'No matching source',
      'menu.voice.needsKey': 'Key required',
      'menu.voice.add': 'Add',
      'menu.voice.addCustom': '+ Add custom source',
      'menu.voice.editorTitle': 'Voice source',
      'menu.voice.type': 'Type',
      'menu.voice.name': 'Name',
      'menu.voice.lang': 'Language',
      'menu.voice.speed': 'Speed',
      'menu.voice.langWarn': 'This source supports only Chinese/English; use system voice or Azure for ja/ko',
      'menu.voice.lang2': 'Language',
      'menu.voice.lang2Hint': 'Auto follows the source; switch to read English/Japanese/Korean',
      'menu.voice.langAuto': 'Follow source',
      'menu.voice.clickMode': 'Tap audio',
      'menu.voice.clickModeHint': 'Voice wins by default so they never overlap; pick Both to layer them',
      'menu.voice.modeAuto': 'Auto (voice first)',
      'menu.voice.modeVoice': 'Voice only',
      'menu.voice.modeSound': 'Sound only',
      'menu.voice.modeBoth': 'Both',
      'menu.voice.library': 'Voice library',
      'menu.voice.libraryHint': 'Search: 御姐 / 萝莉 / male / narration, then tap Add',
      'menu.voice.person': 'Voice',
      'menu.voice.region': 'Region',
      'menu.voice.voiceName': 'Voice name',
      'menu.voice.voiceNameHint': 'empty = system default',
      'menu.voice.keySaved': 'saved, leave blank to keep',
      'menu.voice.webspeechHint': 'Uses the phone system voice, no network. If silent, this WebView does not support it.',
      'menu.voice.apiKey': 'API key',
      'menu.voice.placeholderHint': 'Placeholders: {text}, {lang}, {speed}',
      'menu.voice.cancel': 'Cancel',
      'menu.voice.save': 'Save',
      'menu.harvest': 'Daily voice calibration',
      'menu.harvest.enable': 'Enable daily calibration',
      'menu.harvest.hint': 'Searches Bilibili for the voice every day and keeps only clips that match the anchor timbre and have usable text',
      'menu.harvest.at': 'Run after',
      'menu.harvest.keywords': 'Keywords',
      'menu.harvest.keywordsHint': 'Comma separated, up to 8',
      'menu.harvest.budget': 'Time budget',
      'menu.harvest.minSim': 'Similarity threshold',
      'menu.harvest.minSimHint': 'Clips below this score are dropped so other videos cannot pollute the voice',
      'menu.harvest.autoAdd': 'Add as new voices',
      'menu.harvest.autoAddHint': 'Only adds standalone voices; never changes the current/anchor voice',
      'menu.harvest.anchor': 'Anchor voice',
      'menu.harvest.anchorHint': 'Paste a BV id or Bilibili link to extract a new anchor clip',
      'menu.harvest.anchorSet': 'Set anchor',
      'menu.harvest.anchorUsing': 'Anchor: {name}',
      'menu.harvest.anchorVoice': 'Current voice',
      'menu.harvest.anchorCustom': 'From video',
      'menu.harvest.anchorNone': 'No anchor yet: add a local clone voice or paste a video',
      'menu.harvest.run': 'Run now',
      'menu.harvest.running': 'Calibrating… {time}',
      'menu.harvest.lastRun': 'Last: {when}',
      'menu.harvest.never': 'Never run',
      'menu.harvest.result': 'Result',
      'menu.harvest.noResult': 'No result yet',
      'menu.harvest.notify': 'A reminder pops up next to the pet when done, with a "Turn off fish" button',
      'menu.harvest.minutes': '{n} min',
      'menu.harvest.runningHint': 'Runs in background; you can close this menu',
      'harvest.title': 'Daily calibration',
      'harvest.running': 'Calibrating voice…',
      'harvest.closeFish': 'Turn off fish',
      'harvest.gotIt': 'Got it',
      'harvest.detail': 'Details',
      'harvest.hideDetail': 'Hide',
      'kill.confirm': 'Turn off the fish? The pet hides and voice/calibration pause.',
      'kill.restore': 'Turn on fish',
      'menu.shortcut': 'Shortcut',
      'menu.shortcut.hint': 'Ctrl+Shift+P opens the menu (double-tap the pet too)',
      'menu.shortcut.invalid': 'Invalid format, e.g. ctrl+shift+p',
      'menu.reset': 'Reset',
      'menu.save': 'Save',
      'menu.saved': 'Saved',
      'menu.saving': 'Saving…',
      'menu.uploading': 'Uploading…',
      'menu.upload.fail': 'Failed',
      'menu.switch': 'Switch',
      'menu.current': 'Current',
      'menu.pick': 'Choose file',
      'setting.title': 'Balance pet',
      'setting.desc': 'Show a fish pet in the top-right corner with your DeepSeek balance and weather. Long-press for the full menu.',
    }

    // ==================== 本地 UI 状态 ====================

    /** 读取位置/显隐（纯本地，不进宿主设置）。 */
    function loadPrefs() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return { ...DEFAULT_POS, hidden: false, disabled: false }
        const parsed = JSON.parse(raw)
        return {
          right: Number.isFinite(parsed.right) ? parsed.right : DEFAULT_POS.right,
          top: Number.isFinite(parsed.top) ? parsed.top : DEFAULT_POS.top,
          hidden: parsed.hidden === true,
          disabled: parsed.disabled === true,
        }
      } catch {
        return { ...DEFAULT_POS, hidden: false, disabled: false }
      }
    }

    /** 写入位置/显隐。 */
    function savePrefs(prefs) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
      } catch { /* 隐私模式等 */ }
    }

    // ==================== 跨组件共享的启用状态 ====================

    const enabledState = {
      listeners: new Set(),
      get() {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY)
          if (raw) return JSON.parse(raw).disabled !== true
        } catch { /* ignore */ }
        return true
      },
      set(next) {
        try {
          const prefs = loadPrefs()
          prefs.disabled = next !== true
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
        } catch { /* ignore */ }
        for (const fn of enabledState.listeners) {
          try { fn(next) } catch { /* ignore */ }
        }
      },
      subscribe(fn) {
        enabledState.listeners.add(fn)
        return () => enabledState.listeners.delete(fn)
      },
    }

    /** 订阅启用状态。 */
    function useEnabled() {
      const [on, setOn] = React.useState(() => enabledState.get())
      React.useEffect(() => {
        setOn(enabledState.get())
        return enabledState.subscribe(setOn)
      }, [])
      return on
    }

    // ==================== 快捷键 ====================

    /** 默认快捷键：Ctrl/Cmd + Shift + P。 */
    const DEFAULT_SHORTCUT = { ctrl: true, shift: true, alt: false, key: 'p' }

    /**
     * 解析快捷键描述字符串，形如 'ctrl+shift+p'。
     * 允许修饰键 ctrl / cmd / shift / alt 与单个字母或数字。
     * @param {string} text
     * @returns {{ ctrl: boolean, shift: boolean, alt: boolean, key: string } | null}
     */
    function parseShortcut(text) {
      if (typeof text !== 'string' || text.trim() === '') return null
      const parts = text.toLowerCase().split('+').map(p => p.trim()).filter(Boolean)
      const out = { ctrl: false, shift: false, alt: false, key: '' }
      for (const p of parts) {
        if (p === 'ctrl' || p === 'cmd' || p === 'meta') out.ctrl = true
        else if (p === 'shift') out.shift = true
        else if (p === 'alt' || p === 'option') out.alt = true
        else if (/^[a-z0-9]$/.test(p)) out.key = p
        else return null
      }
      return out.key ? out : null
    }

    /** 判断键盘事件是否匹配快捷键。 */
    function matchShortcut(e, sc) {
      if (!sc || !sc.key) return false
      const key = typeof e.key === 'string' ? e.key.toLowerCase() : ''
      if (key !== sc.key) return false
      return e.ctrlKey === sc.ctrl && e.shiftKey === sc.shift && e.altKey === sc.alt
    }

    // ==================== 样式注入 ====================

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      try {
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = [
          '@keyframes fishpet-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}',
          '@keyframes fishpet-pop{0%{transform:scale(1)}40%{transform:scale(1.18) rotate(-2deg)}100%{transform:scale(1)}}',
          '@keyframes fishpet-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',
          // 卡片内的展示元素一律不接收指针事件，避免图片/文字抢走拖动和缩放把手的按下事件。
          // 需要交互的元素（隐藏按钮、锁标识、缩放把手）在行内样式里显式设回 'auto'。
          '.fishpet-card > *{pointer-events:none}',
          '.fishpet-card > .fishpet-hit{pointer-events:auto}',
          // 捏合中的卡片：轻微放大反馈 + 禁止浏览器接管手势
          '.fishpet-card.fishpet-pinching{transition:transform .08s ease}',
        ].join('\n')
        document.head.appendChild(style)
      } catch { /* ignore */ }
    }

    // ==================== 工具函数 ====================

    /** 格式化金额。 */
    function formatAmount(balance) {
      if (!balance) return '--'
      const value = Number.parseFloat(balance.total)
      if (!Number.isFinite(value)) return balance.total ?? '--'
      return `${value.toFixed(2)} ${balance.currency || ''}`.trim()
    }

    /** 小时数 → 可读时长。 */
    function formatHours(hours) {
      if (!Number.isFinite(hours) || hours <= 0) return '--'
      if (hours >= 24) {
        const d = Math.floor(hours / 24)
        const hr = Math.round(hours % 24)
        return hr > 0 ? `${d}天${hr}小时` : `${d}天`
      }
      const hr = Math.floor(hours)
      const m = Math.round((hours - hr) * 60)
      if (hr === 0) return `${m}分`
      return m > 0 ? `${hr}小时${m}分` : `${hr}小时`
    }

    /** 按本地时间判断昼夜。 */
    function isDaytime() {
      const hour = new Date().getHours()
      return hour >= 6 && hour < 18
    }

    /** 取天气图标（昼夜不同）。 */
    function weatherIcon(kind) {
      const table = WEATHER_ICONS[kind] ?? WEATHER_ICONS.unknown
      return isDaytime() ? table.day : table.night
    }

    /** 读取宿主设置。 */
    async function fetchSettings() {
      try {
        const r = await fetch(PATHS.settings, { credentials: 'same-origin', cache: 'no-store' })
        if (!r.ok) return { ...SETTINGS_DEFAULTS }
        const j = await r.json()
        return { ...SETTINGS_DEFAULTS, ...(j.settings ?? {}) }
      } catch {
        return { ...SETTINGS_DEFAULTS }
      }
    }

    /** 保存宿主设置。 */
    async function putSettings(next) {
      const r = await fetch(PATHS.settings, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.message ?? `HTTP ${r.status}`)
      return { ...SETTINGS_DEFAULTS, ...(j.settings ?? {}) }
    }

    // ==================== 桌宠形象 ====================

    /**
     * 摸摸气泡：始终保持在视口内。
     *
     * 为什么不用卡片内的 absolute 定位：桌宠被拖到角落时，上方/侧边空间不足，
     * 气泡会溢出屏幕看不见。这里改成固定定位 + 实测尺寸 + 四向夹取，
     * 空间不够时自动翻转到下方或另一侧。
     */
    /**
     * 覆盖层错误边界。
     *
     * 之前吃过一次亏：菜单里只要有一个渲染异常，React 会把整棵覆盖层卸载，
     * 表现就是「桌宠突然消失、菜单也打不开」，而且控制台在手机上根本看不到。
     * 这里把菜单/气泡单独包起来：崩了只丢那一块，并把错误上报到宿主便于排查。
     */
    class OverlayErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error, info) {
        try {
          fetch(PATHS.clientError, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              where: String((this.props && this.props.where) || ''),
              message: String((error && error.message) || error || 'unknown'),
              stack: String((error && error.stack) || '').slice(0, 3000),
              componentStack: String((info && info.componentStack) || '').slice(0, 2000),
            }),
          }).catch(() => {})
        } catch { /* 上报失败不影响界面 */ }
      }
      render() {
        // 崩过就渲染空，绝不让异常继续往上冒泡
        return this.state.failed ? null : (this.props && this.props.children) || null
      }
    }

    function PetBubble({ text, anchor }) {
      const ref = React.useRef(null)
      const [pos, setPos] = React.useState(null)

      React.useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const vw = window.innerWidth || 400
        const vh = window.innerHeight || 800
        const GAP = 8
        // 水平：优先右缘与桌宠对齐，两侧都夹进视口
        let left = anchor.right - rect.width
        if (left + rect.width > vw - GAP) left = vw - GAP - rect.width
        if (left < GAP) left = GAP
        // 垂直：默认放上方；上方放不下就翻到下方
        let top = anchor.top - rect.height - GAP
        if (top < GAP) top = anchor.bottom + GAP
        if (top + rect.height > vh - GAP) top = vh - GAP - rect.height
        if (top < GAP) top = GAP
        setPos({ left, top })
      }, [text, anchor.right, anchor.top, anchor.bottom])

      return h('div', {
        ref,
        role: 'status',
        style: {
          position: 'fixed',
          left: pos ? pos.left : -9999,
          top: pos ? pos.top : -9999,
          zIndex: 65,
          maxWidth: Math.min(220, (typeof window !== 'undefined' ? window.innerWidth : 400) - 24),
          padding: '6px 10px',
          borderRadius: 12,
          background: '#fff',
          border: '1.5px solid #2b3a67',
          color: '#2b3a67',
          fontSize: 11,
          lineHeight: 1.4,
          wordBreak: 'break-word',
          boxShadow: '0 3px 10px rgba(0,0,0,.18)',
          animation: 'fishpet-fade .18s ease',
          pointerEvents: 'none',
        },
      }, text)
    }

    /** 桌宠形象。支持内置 PNG 与用户上传的 PNG/JPG/GIF/WebP（GIF 自动播放）。 */
    function PetImage({ settings, petted, onLoadError }) {
      const src = settings.useCustomImage && settings.customImageUrl
        ? settings.customImageUrl
        : PATHS.image
      return h('img', {
        src,
        alt: '',
        draggable: 'false',
        'aria-hidden': 'true',
        onError: onLoadError,
        style: {
          display: 'block',
          width: 'auto',
          height: settings.size,
          maxWidth: 220,
          objectFit: 'contain',
          animation: petted
            ? 'fishpet-pop .5s ease'
            : 'fishpet-bob 3s ease-in-out infinite',
          transformOrigin: '50% 90%',
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.18))',
          pointerEvents: 'none',
          userSelect: 'none',
        },
      })
    }

    // ==================== 动画形象（上游 dsh-pet 透明 webm） ====================
    //
    // 素材来自上游开源项目 PC2005-cloud/dsh-pet（MIT）：106 个 640×360 的
    // VP9-alpha webm。这里只做「播放 + 抽动作」，不搬上游整套物理/漫游逻辑，
    // 保证形象与动作和视频里的一致：
    //   · 待机：循环 idle 池里的「待机呼吸休闲」；
    //   · 随机：按上游分类权重抽一段随机动作，播完回待机；
    //   · 点击：随机播「点击回应-*」，播完回待机；
    //   · 拖拽：播放「被鼠标拖拽悬空反馈」，松手回待机。
    // 为什么用 blob：上游实测 web 端 <video> 直接流式加载偶发失败，一次拿全更稳。

    /** 动画清单缓存（5 秒内复用，避免频繁请求）。 */
    let animManifestCache = null
    let animManifestAt = 0
    /** 动画名 → blob URL；同一份素材只下载一次。 */
    const animBlobCache = new Map()

    /**
     * 拉取动画清单。
     * @param {boolean} [force] - 忽略 5 秒缓存。
     * @returns {Promise<object>}
     */
    async function fetchAnimationManifest(force) {
      const now = Date.now()
      if (!force && animManifestCache && now - animManifestAt < 5000) return animManifestCache
      const r = await fetch(PATHS.animations, { credentials: 'same-origin', cache: 'no-store' })
      const j = await r.json().catch(() => null)
      animManifestCache = j && typeof j === 'object' ? j : { ok: false, reason: 'BAD_RESPONSE' }
      animManifestAt = now
      return animManifestCache
    }

    /**
     * 取一段动画的 blob URL（带缓存）。
     * @param {string} name
     * @returns {Promise<string>}
     */
    async function loadAnimationClip(name, matte = false) {
      const key = `${matte ? 'm' : 't'}:${name}`
      if (animBlobCache.has(key)) return animBlobCache.get(key)
      const base = matte ? PATHS.animationMatteBase : PATHS.animationBase
      const url = `${base}/${encodeURIComponent(name)}.webm`
      const r = await fetch(url, { credentials: 'same-origin' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const buf = await r.arrayBuffer()
      // 显式指定 video/webm，保证 VP9 的 alpha 通道被保留（透明背景）
      const blobUrl = URL.createObjectURL(new window.Blob([buf], { type: 'video/webm' }))
      animBlobCache.set(key, blobUrl)
      return blobUrl
    }

    /**
     * 探测当前 WebView 的 <video> 是否真的保留 VP9 alpha。
     *
     * 桌面 Chrome / Electron 支持透明背景；Android 的 MediaCodec / ExoPlayer
     * 一般会把 alpha 丢掉、渲染成黑底。做法：把一帧画到 canvas 上读左上角像素的
     * alpha——素材人物居中、左上角一定是透明的。
     *
     * 探测失败（video 解码异常、canvas 被污染等）时按「支持」处理，
     * 交给正常播放路径，避免误判导致功能整体不可用。
     *
     * @param {string} url - 一段已知左上角透明的动画 blob URL。
     * @returns {Promise<boolean>}
     */
    async function detectVideoAlpha(url) {
      let video = null
      try {
        video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.src = url
        await new Promise((resolve, reject) => {
          if (video.readyState >= 2) { resolve(); return }
          const cleanups = []
          const finish = (ok, error) => {
            for (const fn of cleanups) fn()
            if (ok) resolve()
            else reject(error)
          }
          const onReady = () => finish(true)
          const onError = () => finish(false, new Error('probe decode failed'))
          video.addEventListener('loadeddata', onReady)
          video.addEventListener('error', onError)
          cleanups.push(() => video.removeEventListener('loadeddata', onReady))
          cleanups.push(() => video.removeEventListener('error', onError))
          cleanups.push(() => window.clearTimeout(timer))
          const timer = window.setTimeout(() => finish(false, new Error('probe timeout')), 4000)
        })
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 36
        const ctx = canvas.getContext('2d')
        if (!ctx) return true
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const alpha = ctx.getImageData(1, 1, 1, 1).data[3]
        return alpha < 16
      } catch {
        return true
      } finally {
        if (video) {
          video.removeAttribute('src')
          try { video.load() } catch { /* ignore */ }
        }
      }
    }

    /** 从数组里等概率抽一个；空数组返回空串。 */
    function pickOne(list) {
      if (!Array.isArray(list) || list.length === 0) return ''
      return list[Math.floor(Math.random() * list.length)]
    }

    /**
     * 按权重抽一个随机动作分类。
     * @param {Array<{ weight: number, actions: string[] }>} categories
     * @returns {object|null}
     */
    function pickRandomCategory(categories) {
      const pool = (categories || []).filter(c => c && Array.isArray(c.actions) && c.actions.length > 0)
      const total = pool.reduce((sum, c) => sum + Math.max(0, Number(c.weight) || 0), 0)
      if (total <= 0) return null
      let roll = Math.random() * total
      for (const category of pool) {
        roll -= Math.max(0, Number(category.weight) || 0)
        if (roll < 0) return category
      }
      return pool[pool.length - 1]
    }

    /**
     * 动画画布宽度：把「桌宠大小 size」换算成 640×360 播放画布的显示宽度。
     *
     * 可见人物高度 = 270/640 × 画布宽，所以画布宽 = size × 2.37 时人物高 ≈ size，
     * 与图片/Live2D 模式的大小语义一致。
     *
     * @param {number} settingSize - 设置里的 size（人物可见高度语义）。
     * @returns {number} 画布宽度（px）。
     */
    function animationStageWidth(settingSize) {
      const raw = Math.round((Number(settingSize) || SIZE_BASE) * ANIM_SIZE_FACTOR)
      return Math.min(ANIM_SIZE_LIMITS[1], Math.max(ANIM_SIZE_LIMITS[0], raw))
    }

    /**
     * 动画形象：双 <video> 交叉淡入，一个在播、另一个预载下一段。
     *
     * 与上游同一套做法：切换时把新动画装到背面元素、播放成功后换前景，
     * 0.18s 的 opacity 过渡，动作之间不会黑屏或闪烁。
     */
    function AnimationPet({ settings, petted, pettedTick, dragging, onError, t }) {
      const videoARef = React.useRef(null)
      const videoBRef = React.useRef(null)
      /** 当前前景是 0(A) 还是 1(B)。 */
      const frontRef = React.useRef(0)
      const [front, setFront] = React.useState(0)
      const [manifest, setManifest] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      // 当前 WebView 不支持透明 webm 时，自动改用「白底 + 正片叠底」版本
      const [matte, setMatte] = React.useState(false)
      const matteRef = React.useRef(false)
      // alpha 探测完成前不响应随机/点击/拖拽，避免用错版本闪一下黑底
      const modeReadyRef = React.useRef(false)

      const manifestRef = React.useRef(null)
      const idleRef = React.useRef('')
      const currentRef = React.useRef({ name: '', loop: false })
      const timerRef = React.useRef(null)
      const aliveRef = React.useRef(true)
      const draggingRef = React.useRef(false)
      const pettedRef = React.useRef(null)
      // onError 是父组件每次渲染新建的箭头函数，用 ref 保存避免把挂载 effect 变成每帧重跑
      const onErrorRef = React.useRef(onError)
      onErrorRef.current = onError
      // 定时器/回调里要读最新的设置与交互状态
      const latestRef = React.useRef({ settings, petted, dragging })
      latestRef.current = { settings, petted, dragging }
      draggingRef.current = !!dragging
      pettedRef.current = petted

      /** 切到指定动画；loop=true 时循环播放。 */
      const seqRef = React.useRef(0)
      const playClip = React.useCallback(async (name, loop) => {
        const m = manifestRef.current
        if (!name || !m || !m.ok) return false
        const frontEl = frontRef.current === 0 ? videoARef.current : videoBRef.current
        if (currentRef.current.name === name && currentRef.current.loop === (loop === true)) {
          if (frontEl && frontEl.paused) frontEl.play().catch(() => {})
          return true
        }
        // 并发保护：点击和随机动作可能同时触发，只认最后一次请求，避免两个请求抢同一个背面元素
        seqRef.current += 1
        const seq = seqRef.current
        let url
        try {
          url = await loadAnimationClip(name, matteRef.current)
        } catch {
          return false
        }
        if (!aliveRef.current || seq !== seqRef.current) return false
        // 装到「背面」：当前前景是 A 就用 B，反之亦然
        const backIsA = frontRef.current !== 0
        const back = backIsA ? videoARef.current : videoBRef.current
        if (!back) return false
        back.loop = loop === true
        if (back.dataset.clip !== name) {
          back.dataset.clip = name
          back.src = url
          // 等首帧真的解出来再切前景：换 src 后立刻 play() 在部分 WebView 会 reject，
          // 表现就是「切了一次动作之后再也不动了」。blob 本地读取一般 <100ms。
          await new Promise(resolve => {
            if (back.readyState >= 2) { resolve(); return }
            let done = false
            const finish = () => {
              if (done) return
              done = true
              back.removeEventListener('loadeddata', finish)
              back.removeEventListener('error', finish)
              resolve()
            }
            back.addEventListener('loadeddata', finish)
            back.addEventListener('error', finish)
            window.setTimeout(finish, 4000)
          })
        }
        if (!aliveRef.current || seq !== seqRef.current) return false
        try { back.currentTime = 0 } catch { /* 尚未 loadedmetadata 时忽略 */ }
        try {
          await back.play()
        } catch {
          // 自动播放被拦时不切前景，保留上一帧，避免黑屏
          return false
        }
        if (!aliveRef.current || seq !== seqRef.current) return false
        currentRef.current = { name, loop: loop === true }
        frontRef.current = backIsA ? 0 : 1
        setFront(frontRef.current)
        return true
      }, [])

      /** 排一次随机动作；delay 省略时在 12–28 秒之间随机。 */
      const scheduleRandom = React.useCallback(delayMs => {
        if (timerRef.current) window.clearTimeout(timerRef.current)
        const m = manifestRef.current
        if (!m || !m.ok || !modeReadyRef.current) return
        if (!latestRef.current.settings.animRandomEnabled) return
        const delay = Number.isFinite(delayMs)
          ? delayMs
          : ANIM_RANDOM_MIN_MS + Math.random() * (ANIM_RANDOM_MAX_MS - ANIM_RANDOM_MIN_MS)
        timerRef.current = window.setTimeout(() => {
          const mm = manifestRef.current
          if (!mm || !mm.ok) return
          // 正在被拖/被摸：让位给交互动作，过几秒再排
          if (draggingRef.current || pettedRef.current) {
            scheduleRandom(4000)
            return
          }
          const category = pickRandomCategory(mm.pools.categories)
          const action = category ? pickOne(category.actions) : ''
          if (!action) {
            scheduleRandom(12000)
            return
          }
          playClip(action, false).then(ok => { if (!ok) scheduleRandom(8000) })
        }, delay)
      }, [playClip])

      /** 一段一次性动画播完 → 回待机，并排下一次随机。 */
      const handleEnded = React.useCallback(event => {
        const el = event.currentTarget
        const frontEl = frontRef.current === 0 ? videoARef.current : videoBRef.current
        if (el !== frontEl) return
        if (currentRef.current.loop) return
        if (idleRef.current) playClip(idleRef.current, true)
        scheduleRandom()
      }, [playClip, scheduleRandom])

      // 首次挂载：拉清单（只拉一次）
      React.useEffect(() => {
        let cancelled = false
        aliveRef.current = true
        fetchAnimationManifest(true).then(m => {
          if (cancelled) return
          if (!m || !m.ok) {
            setFailed(true)
            onErrorRef.current?.(m?.reason || 'NO_ASSETS')
            return
          }
          setManifest(m)
        }).catch(() => {
          if (cancelled) return
          setFailed(true)
          onErrorRef.current?.('MANIFEST_FAILED')
        })
        return () => {
          cancelled = true
          aliveRef.current = false
          if (timerRef.current) window.clearTimeout(timerRef.current)
        }
      }, [])

      // 清单就绪后（video 元素已挂载）才真正开播——在 fetch 回调里直接播会因为 ref 还没挂上而失败
      React.useEffect(() => {
        if (!manifest || !manifest.ok) return
        manifestRef.current = manifest
        const idle = (manifest.pools && manifest.pools.idle && manifest.pools.idle[0]) || ''
        idleRef.current = idle
        let cancelled = false
        ;(async () => {
          // 先探测 alpha：桌面浏览器保留透明背景，Android WebView 多半会丢成黑底
          let alphaOk = true
          if (idle) {
            try {
              alphaOk = await detectVideoAlpha(await loadAnimationClip(idle, false))
            } catch { /* 探测失败按支持处理 */ }
          }
          if (cancelled || !aliveRef.current) return
          const matteInfo = manifest.matte
          const matteReady = !!(matteInfo && matteInfo.available && matteInfo.complete)
          if (!alphaOk && !matteReady) {
            // 既不支持透明、也没有白底版本：回退图片形象比黑底方块体面
            setFailed(true)
            onErrorRef.current?.('NO_ALPHA')
            return
          }
          const useMatte = !alphaOk && matteReady
          matteRef.current = useMatte
          modeReadyRef.current = true
          setMatte(useMatte)
          if (idle) playClip(idle, true)
          // 预载点击回应：点下去的反馈要立刻出现
          const clicks = (manifest.pools && Array.isArray(manifest.pools.clicks)) ? manifest.pools.clicks : []
          for (const name of clicks.slice(0, 2)) loadAnimationClip(name, useMatte).catch(() => {})
          scheduleRandom()
        })()
        return () => { cancelled = true }
      }, [manifest, playClip, scheduleRandom])

      // 摸摸：播一段点击回应（与上游一致，随机抽）
      React.useEffect(() => {
        if (!petted) return
        const m = manifestRef.current
        if (!m || !m.ok || !modeReadyRef.current) return
        if (latestRef.current.settings.animClickEnabled === false) return
        const name = pickOne(m.pools.clicks) || idleRef.current
        if (!name) return
        playClip(name, false).then(ok => { if (!ok && idleRef.current) playClip(idleRef.current, true) })
        scheduleRandom()
      }, [petted, pettedTick, playClip, scheduleRandom])

      // 拖拽：播放被拎起的姿势，松手回待机
      React.useEffect(() => {
        const m = manifestRef.current
        if (!m || !m.ok || !modeReadyRef.current) return
        if (dragging) {
          const name = pickOne(m.pools.drag)
          if (name) playClip(name, true)
        } else if (idleRef.current) {
          playClip(idleRef.current, true)
          scheduleRandom(6000)
        }
      }, [dragging, playClip, scheduleRandom])

      // 画布宽 → 缩放比例；卡片/热区只包人物框（ANIM_CHAR_BOX），不包整块 16:9 透明画布
      const stageW = animationStageWidth(settings.size)
      const scale = stageW / ANIM_VIDEO_WIDTH
      const charW = Math.max(28, Math.round(ANIM_CHAR_BOX.w * scale))
      const charH = Math.max(32, Math.round(ANIM_CHAR_BOX.h * scale))

      if (failed || !manifest || !manifest.ok) {
        return h('div', {
          style: {
            width: charW, height: charH, display: 'flex', alignItems: 'center',
            justifyContent: 'center', boxSizing: 'border-box', padding: 8,
            fontSize: 10, lineHeight: 1.4, color: '#c0392b', textAlign: 'center',
          },
        }, failed ? t('menu.anim.missing') : t('menu.anim.loading'))
      }

      const videoStyle = {
        position: 'absolute',
        width: Math.round(ANIM_VIDEO_WIDTH * scale),
        height: Math.round(ANIM_VIDEO_HEIGHT * scale),
        // 把画布按人物框对齐：视频左上角相对卡片外移
        left: -Math.round(ANIM_CHAR_BOX.x * scale),
        top: -Math.round(ANIM_CHAR_BOX.y * scale),
        objectFit: 'fill',
        pointerEvents: 'none',
        userSelect: 'none',
        transition: 'opacity .18s ease',
        // 白底版本靠 multiply 把白底「抠掉」；透明版本才需要投影
        mixBlendMode: matte ? 'multiply' : 'normal',
        filter: matte ? 'none' : 'drop-shadow(0 3px 6px rgba(0,0,0,.18))',
      }
      const makeVideo = (which, ref) => h('video', {
        key: which,
        ref: el => {
          ref.current = el
          if (!el) return
          // React 的 muted 属性在部分 WebView 不生效，直接设 DOM 属性最稳
          el.muted = true
          el.defaultMuted = true
          el.playsInline = true
          el.setAttribute('playsinline', '')
          el.setAttribute('webkit-playsinline', '')
        },
        muted: true,
        preload: 'auto',
        playsInline: true,
        'aria-hidden': 'true',
        disablePictureInPicture: true,
        onEnded: handleEnded,
        style: { ...videoStyle, opacity: front === (which === 'a' ? 0 : 1) ? 1 : 0 },
      })

      return h('div', {
        style: {
          position: 'relative', width: charW, height: charH,
          // 不裁剪：烟花/落叶等大特效会超出人物框，视频本身是透明背景
          overflow: 'visible', pointerEvents: 'none',
        },
      }, [
        makeVideo('a', videoARef),
        makeVideo('b', videoBRef),
      ])
    }

    // ==================== 动态形象（伪 Live2D） ====================

    /**
     * 把当前静态形象「动态化」。
     *
     * 这不是真正的 Cubism 模型：没有 .moc3、没有分层部件，也做不到单独驱动眼睛/嘴巴。
     * 做法是把图片横向切成细条，用多相位正弦 + 指针视差 + 摸摸冲击做整体变形，
     * 视觉上像有呼吸、会跟着你动、被戳会弹一下。优点是对任意图片立即生效。
     *
     * 真 Live2D 需要 Cubism Editor 制作的模型，走「Live2D 模型」上传入口。
     */
    function DynamicPet({ settings, petted, onError, t }) {
      const canvasRef = React.useRef(null)
      const imageRef = React.useRef(null)
      const pointerRef = React.useRef({ x: 0, y: 0, tx: 0, ty: 0 })
      const petAtRef = React.useRef(0)
      const prevPettedRef = React.useRef(false)
      const [aspect, setAspect] = React.useState(0.72)
      const [ready, setReady] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      const src = settings.useCustomImage && settings.customImageUrl
        ? settings.customImageUrl
        : PATHS.image
      const targetH = Math.max(38, Math.round(settings.size))
      const targetW = Math.max(24, Math.round(targetH * aspect))
      const intensity = Math.max(0, Math.min(1.5, Number(settings.dynamicIntensity) || 0))
      // 动画循环里要读最新值，但不想因为拖动滑块重启循环
      const liveRef = React.useRef({ intensity, petted })
      liveRef.current = { intensity, petted }

      // 加载图片：内置图或自定义图都走这条路
      React.useEffect(() => {
        let cancelled = false
        setReady(false)
        setFailed(false)
        imageRef.current = null
        const image = new window.Image()
        image.decoding = 'async'
        image.onload = () => {
          if (cancelled) return
          imageRef.current = image
          const ratio = image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : 0.72
          setAspect(Math.max(0.25, Math.min(3, ratio)))
          setReady(true)
        }
        image.onerror = () => {
          if (cancelled) return
          setFailed(true)
          if (typeof onError === 'function') onError('IMAGE_LOAD_FAILED')
        }
        image.src = src
        return () => {
          cancelled = true
          image.onload = null
          image.onerror = null
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [src])

      // 渲染循环
      React.useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !ready) return
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          setFailed(true)
          if (typeof onError === 'function') onError('CANVAS_UNSUPPORTED')
          return
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const cssW = Math.max(24, Math.round(targetH * aspect))
        const cssH = targetH
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
        canvas.style.width = `${cssW}px`
        canvas.style.height = `${cssH}px`

        let raf = 0
        let start = 0
        const STRIPS = 56
        const draw = now => {
          raf = window.requestAnimationFrame(draw)
          if (document.visibilityState === 'hidden') return
          const image = imageRef.current
          if (!image) return
          if (!start) start = now
          const tSec = (now - start) / 1000
          const amp = liveRef.current.intensity

          // 指针坐标缓动，避免视线像机械臂一样跳
          const pointer = pointerRef.current
          pointer.x += (pointer.tx - pointer.x) * 0.07
          pointer.y += (pointer.ty - pointer.y) * 0.07

          // 摸摸冲击：指数衰减的正弦抖动
          if (liveRef.current.petted && !prevPettedRef.current) petAtRef.current = now
          prevPettedRef.current = liveRef.current.petted
          const sincePet = petAtRef.current ? (now - petAtRef.current) / 1000 : 99
          const reaction = sincePet < 2 ? Math.exp(-sincePet * 2.6) * Math.sin(sincePet * 13) : 0

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, cssW, cssH)
          const srcW = image.naturalWidth
          const srcH = image.naturalHeight
          if (!srcW || !srcH) return
          const stripSrc = srcH / STRIPS
          const stripDest = cssH / STRIPS
          const breathe = 1 + Math.sin(tSec * 1.7) * 0.008 * amp

          ctx.save()
          // 呼吸：以底部为锚点轻微缩放，看起来像在吸气
          ctx.translate(0, cssH)
          ctx.scale(1, breathe)
          ctx.translate(0, -cssH)
          for (let i = 0; i < STRIPS; i++) {
            const ny = i / (STRIPS - 1)
            // 越靠上（头发/头）摆动越大，底部相对稳定
            const sway = Math.sin(tSec * 1.5 + ny * 1.7) * 2.4 * amp * (0.35 + 0.65 * (1 - ny))
            // 指针视差：头跟着指针走，脚基本不动
            const parallax = pointer.x * 7 * amp * (1 - ny * 0.7)
            const tiltY = pointer.y * 2 * amp * (1 - ny)
            const bounce = reaction * 7 * amp * (1 - ny)
            ctx.drawImage(
              image,
              0, i * stripSrc, srcW, stripSrc + 0.5,
              sway + parallax,
              i * stripDest + tiltY + bounce - 0.5,
              cssW, stripDest + 1.2,
            )
          }
          ctx.restore()
        }
        raf = window.requestAnimationFrame(draw)

        const onPointerMove = event => {
          const tx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1
          const ty = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1
          pointerRef.current.tx = Math.max(-1, Math.min(1, tx))
          pointerRef.current.ty = Math.max(-1, Math.min(1, ty))
        }
        window.addEventListener('pointermove', onPointerMove, { passive: true })
        return () => {
          window.cancelAnimationFrame(raf)
          window.removeEventListener('pointermove', onPointerMove)
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [ready, aspect, targetH])

      if (failed) return null

      return h('div', {
        style: {
          position: 'relative',
          width: targetW,
          height: targetH,
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.18))',
          transformOrigin: '50% 90%',
          animation: petted ? 'fishpet-pop .5s ease' : 'none',
          pointerEvents: 'none',
          userSelect: 'none',
        },
      }, [
        h('canvas', {
          key: 'c',
          ref: canvasRef,
          'aria-hidden': 'true',
          style: {
            display: 'block',
            width: targetW,
            height: targetH,
            pointerEvents: 'none',
          },
        }),
        ready ? null : h('div', {
          key: 'hint',
          style: {
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: '#7b8794',
          },
        }, t ? t('menu.dynamic.loading') : '…'),
      ])
    }

    // ==================== Live2D 运行时 ====================

    /**
     * 动态加载一个脚本（同源、插件自带，无需外网 CDN）。
     *
     * 为什么不用 import()：运行时是 UMD 包，需要按顺序建立 PIXI /
     * Live2DCubismCore 全局，再让显示库挂到 PIXI.live2d 上。
     */
    function loadRuntimeScript(url) {
      return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') { reject(new Error('无 document')); return }
        const script = document.createElement('script')
        script.src = url
        // 动态插入的 classic script 保持同步语义：运行时三个文件必须按顺序执行
        script.async = false
        const timer = window.setTimeout(() => {
          script.remove()
          reject(new Error(`运行时脚本加载超时：${url}`))
        }, 20000)
        script.onload = () => { window.clearTimeout(timer); resolve() }
        script.onerror = () => {
          window.clearTimeout(timer)
          script.remove()
          reject(new Error(`运行时脚本加载失败：${url}`))
        }
        document.head.appendChild(script)
      })
    }

    /** 运行时加载 Promise 缓存：多个桌宠实例/重复渲染只加载一次。 */
    let live2dRuntimePromise = null

    /**
     * 确保 PIXI、Cubism Core、pixi-live2d-display 都已就绪。
     * @returns {Promise<object>} window.PIXI.live2d
     */
    function loadLive2DRuntime() {
      if (live2dRuntimePromise) return live2dRuntimePromise
      live2dRuntimePromise = (async () => {
        if (!window.PIXI) await loadRuntimeScript(`${PATHS.live2dRuntime}/pixi.min.js`)
        if (!window.Live2DCubismCore) await loadRuntimeScript(`${PATHS.live2dRuntime}/live2dcubismcore.min.js`)
        if (!(window.PIXI && window.PIXI.live2d)) await loadRuntimeScript(`${PATHS.live2dRuntime}/cubism4.min.js`)
        const lib = window.PIXI && window.PIXI.live2d
        if (!lib || !lib.Live2DModel) throw new Error('Live2D 运行时初始化失败')
        // 显式注册 ticker：不注册也会回退到 window.PIXI.Ticker，但显式更稳
        try { lib.Live2DModel.registerTicker(window.PIXI.Ticker) } catch { /* 已注册时忽略 */ }
        return lib
      })().catch(error => {
        // 失败后允许下次重试（例如一次网络抖动）
        live2dRuntimePromise = null
        throw error
      })
      return live2dRuntimePromise
    }

    /** 当前 WebView 是否支持 WebGL（Live2D 渲染的硬性前提）。 */
    function supportsWebGL() {
      if (typeof document === 'undefined') return false
      try {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
        if (!gl) return false
        // 主动释放探测用的上下文，避免占着 WebGL context 名额
        const lose = gl.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
        return true
      } catch {
        return false
      }
    }

    /**
     * 拼出模型的 model3.json 地址（路径式）。
     *
     * 必须保持路径式：model3.json 里的 moc3 / 贴图 / 动作都是相对路径，
     * 浏览器按 model3.json 的 URL 做相对解析，路径式才能解析到同目录下的文件。
     */
    function live2dModelUrl(id, modelJsonPath) {
      const relative = String(modelJsonPath || '')
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/')
      return `${PATHS.live2dModelBase}/${encodeURIComponent(id)}/${relative}`
    }

    /** 模型列表缓存：菜单和桌宠主体共用，避免各拉一次。 */
    let live2dModelsCache = { at: 0, models: null, promise: null }

    /**
     * 拉取 Live2D 模型列表（带 5 秒缓存）。
     * @param {boolean} [force] - 忽略缓存。
     * @returns {Promise<Array<object>>}
     */
    async function fetchLive2DModels(force) {
      const now = Date.now()
      if (!force && Array.isArray(live2dModelsCache.models) && now - live2dModelsCache.at < 5000) {
        return live2dModelsCache.models
      }
      if (live2dModelsCache.promise) return live2dModelsCache.promise
      live2dModelsCache.promise = (async () => {
        try {
          const r = await fetch(PATHS.live2dModels, { credentials: 'same-origin', cache: 'no-store' })
          const j = await r.json().catch(() => ({}))
          const models = r.ok && j && j.ok && Array.isArray(j.models) ? j.models : []
          live2dModelsCache = { at: Date.now(), models, promise: null }
          return models
        } catch {
          live2dModelsCache = { at: 0, models: [], promise: null }
          return []
        }
      })()
      return live2dModelsCache.promise
    }

    /**
     * 随机播一个「摸摸」动作：优先点按类动作组，没有就随机一个非待机组。
     * @param {object} model - Live2DModel 实例。
     */
    function playLive2DMotion(model) {
      if (!model) return
      try {
        const manager = model.internalModel && model.internalModel.motionManager
        const definitions = (manager && manager.definitions) || {}
        const groups = Object.keys(definitions).filter(name => Array.isArray(definitions[name]) && definitions[name].length > 0)
        if (groups.length === 0) return
        const preferred = ['TapHead', 'TapBody', 'tap_head', 'tap_body', 'Tap', 'tap', 'FlickHead', 'Use']
        const group = preferred.find(name => groups.includes(name)) || groups.find(name => name !== 'Idle') || 'Idle'
        // 用 NORMAL 优先级：能打断待机，又不会被待机循环顶掉
        model.motion(group, undefined, 2)
        const expressions = manager && manager.expressionManager && manager.expressionManager.definitions
        if (Array.isArray(expressions) && expressions.length > 0 && Math.random() < 0.6) {
          model.expression()
        }
      } catch { /* 动作失败不影响摸摸反馈 */ }
    }

    /**
     * Live2D 桌宠形象。
     *
     * 只负责「加载 + 渲染 + 清理」；点击/长按/拖动仍由外层卡片处理，
     * 所以 WebGL 渲染不会抢走手势。失败时通过 onError 通知父组件回退图片。
     */
    function Live2DPet({ settings, petted, onError, t }) {
      const hostRef = React.useRef(null)
      const appRef = React.useRef(null)
      const modelRef = React.useRef(null)
      const layoutRef = React.useRef(null)
      const sizeRef = React.useRef({})
      const [phase, setPhase] = React.useState('loading')
      const [hint, setHint] = React.useState('')

      const width = Math.max(38, Math.round(settings.size))
      const height = Math.max(38, Math.round(settings.size))
      sizeRef.current = {
        width,
        height,
        scale: Number(settings.live2dScale) || 1,
        offsetX: Number(settings.live2dOffsetX) || 0,
        offsetY: Number(settings.live2dOffsetY) || 0,
      }

      // 加载模型：只在模型 id 变化时重建，尺寸/偏移变化走下面的布局 effect
      React.useEffect(() => {
        let disposed = false
        let app = null
        let model = null
        let canvas = null
        const host = hostRef.current
        setPhase('loading')
        setHint('')

        const cleanupLocal = () => {
          layoutRef.current = null
          modelRef.current = null
          appRef.current = null
          try { if (model) model.destroy() } catch { /* ignore */ }
          try { if (app) app.destroy(true, { children: true, texture: true, baseTexture: true }) } catch { /* ignore */ }
          // 只清理自己创建的 canvas，绝不能动 React 管理的 loading 占位节点
          try { if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas) } catch { /* ignore */ }
          model = null
          app = null
          canvas = null
        }

        ;(async () => {
          try {
            if (!settings.live2dModel) throw new Error('NO_MODEL')
            if (!supportsWebGL()) {
              const error = new Error('NO_WEBGL')
              error.code = 'NO_WEBGL'
              throw error
            }
            await loadLive2DRuntime()
            if (disposed) return
            const models = await fetchLive2DModels()
            const entry = models.find(item => item.id === settings.live2dModel)
            if (!entry) throw new Error('MODEL_NOT_FOUND')
            if (disposed || !host) return

            canvas = document.createElement('canvas')
            canvas.style.display = 'block'
            canvas.style.width = '100%'
            canvas.style.height = '100%'
            canvas.style.pointerEvents = 'none'
            host.appendChild(canvas)

            const PIXI = window.PIXI
            app = new PIXI.Application({
              view: canvas,
              width,
              height,
              backgroundAlpha: 0,
              antialias: true,
              autoDensity: true,
              resolution: Math.min(window.devicePixelRatio || 1, 2),
              powerPreference: 'low-power',
            })
            // 手机端 30fps 足够顺滑，省电也省发热
            app.ticker.maxFPS = 30
            appRef.current = app

            const modelUrl = live2dModelUrl(entry.id, entry.modelJsonPath)
            model = await PIXI.live2d.Live2DModel.from(modelUrl, {
              autoInteract: false,
              autoUpdate: true,
              idleMotionGroup: 'Idle',
            })
            if (disposed) { cleanupLocal(); return }
            model.anchor.set(0.5, 0.5)
            app.stage.addChild(model)
            modelRef.current = model

            const applyLayout = () => {
              const currentApp = appRef.current
              const currentModel = modelRef.current
              if (!currentApp || !currentModel) return
              const target = sizeRef.current
              currentApp.renderer.resize(target.width, target.height)
              const baseW = Math.max(1, (currentModel.internalModel && currentModel.internalModel.width) || currentModel.width || 1)
              const baseH = Math.max(1, (currentModel.internalModel && currentModel.internalModel.height) || currentModel.height || 1)
              // 先按「完整画布能装下」适配，再乘用户缩放
              const fit = Math.min(target.width / baseW, target.height / baseH) * target.scale
              currentModel.scale.set(fit)
              currentModel.x = target.width / 2 + target.offsetX * target.width
              currentModel.y = target.height / 2 + target.offsetY * target.height
            }
            layoutRef.current = applyLayout
            applyLayout()
            setPhase('ready')
          } catch (error) {
            if (disposed) return
            cleanupLocal()
            const code = error && error.code ? error.code : 'LOAD_FAILED'
            setPhase('error')
            setHint(code)
            if (typeof onError === 'function') onError(code, error)
          }
        })()

        return () => {
          disposed = true
          cleanupLocal()
        }
      // 只在模型切换时重建；尺寸与偏移由下面的 effect 处理
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [settings.live2dModel])

      // 尺寸 / 缩放 / 偏移变化：不重载模型，只重排
      React.useEffect(() => {
        if (layoutRef.current) layoutRef.current()
      }, [width, height, settings.live2dScale, settings.live2dOffsetX, settings.live2dOffsetY])

      // 摸摸时播动作
      React.useEffect(() => {
        if (!petted || !settings.live2dMotion) return
        playLive2DMotion(modelRef.current)
      }, [petted, settings.live2dMotion])

      // 视线跟随：把指针位置换算成画布内坐标喂给模型
      React.useEffect(() => {
        if (!settings.live2dLookAt || typeof window === 'undefined') return
        let raf = 0
        let last = null
        const apply = () => {
          raf = 0
          const target = last
          const model = modelRef.current
          if (!target || !model || typeof model.focus !== 'function') return
          try {
            const host = hostRef.current
            if (!host) return
            const rect = host.getBoundingClientRect()
            const x = Math.min(rect.width, Math.max(0, target.clientX - rect.left))
            const y = Math.min(rect.height, Math.max(0, target.clientY - rect.top))
            model.focus(x, y)
          } catch { /* 指针跟随失败不影响主流程 */ }
        }
        const onMove = event => {
          last = event
          if (raf) return
          raf = window.requestAnimationFrame(apply)
        }
        window.addEventListener('pointermove', onMove, { passive: true })
        return () => {
          window.removeEventListener('pointermove', onMove)
          if (raf) window.cancelAnimationFrame(raf)
        }
      }, [settings.live2dLookAt, settings.live2dModel])

      return h('div', {
        ref: hostRef,
        'aria-hidden': 'true',
        style: {
          position: 'relative',
          width,
          height,
          lineHeight: 0,
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.18))',
          animation: petted ? 'fishpet-pop .5s ease' : 'none',
          transformOrigin: '50% 90%',
        },
      }, phase === 'loading' ? h('div', {
        style: {
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 9, lineHeight: 1.3, color: '#7b8794',
          textAlign: 'center', padding: 4, boxSizing: 'border-box',
          whiteSpace: 'normal',
        },
      }, hint || (t ? t('menu.live2d.loading') : 'Live2D…')) : null)
    }

    /** 桌宠形象分发：动画 / Live2D / 动态形象优先，失败时回退静态图片。 */
    function PetVisual({
      settings, petted, pettedTick, dragging, live2dFailed, dynamicFailed, animFailed,
      onLoadError, onLive2DError, onDynamicError, onAnimError, t,
    }) {
      if (settings.appearance === 'animation' && !animFailed) {
        return h(AnimationPet, {
          settings, petted, pettedTick, dragging, onError: onAnimError, t,
        })
      }
      if (settings.appearance === 'live2d' && settings.live2dModel && !live2dFailed) {
        return h(Live2DPet, { settings, petted, onError: onLive2DError, t })
      }
      if (settings.appearance === 'dynamic' && !dynamicFailed) {
        return h(DynamicPet, { settings, petted, onError: onDynamicError, t })
      }
      return h(PetImage, { settings, petted, onLoadError })
    }

    // ==================== 通用小部件 ====================

    /** 菜单行：标题 + 右侧控件 + 可选提示。 */
    function Row({ label, hint, children }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '7px 0' } }, [
        h('div', {
          key: 'top',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
        }, [
          h('div', { key: 'l', style: { fontSize: 13 } }, label),
          h('div', { key: 'r', style: { flex: '0 0 auto' } }, children),
        ]),
        hint ? h('div', {
          key: 'hint',
          style: { fontSize: 11, opacity: 0.6, lineHeight: 1.4 },
        }, hint) : null,
      ])
    }

    /** 分组标题。 */
    function Section({ title }) {
      return h('div', {
        style: {
          fontSize: 11, fontWeight: 700, opacity: 0.55,
          letterSpacing: '.04em', marginTop: 13, marginBottom: 1,
        },
      }, title)
    }

    /** 拨动开关。 */
    function Toggle({ on, onChange, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': label,
        onClick: () => onChange(!on),
        style: {
          width: 44, height: 24, borderRadius: 999, padding: 0, cursor: 'pointer',
          border: '1px solid ' + (on ? '#2fa37a' : 'rgba(0,0,0,.18)'),
          background: on ? '#34b98b' : 'rgba(0,0,0,.12)',
          position: 'relative', transition: 'background .18s ease',
        },
      }, h('span', {
        style: {
          position: 'absolute', top: 2, left: on ? 21 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .18s ease',
        },
      }))
    }

    /** 小号描边按钮。 */
    function GhostButton({ onClick, disabled, accent, children }) {
      return h('button', {
        type: 'button',
        disabled,
        onClick,
        style: {
          fontSize: 12, padding: '5px 10px', borderRadius: 8,
          cursor: disabled ? 'default' : 'pointer',
          border: accent ? '1px solid #2fa37a' : '1px solid rgba(0,0,0,.15)',
          color: accent ? '#1f7d5c' : 'inherit',
          background: accent ? 'rgba(47,163,122,.08)' : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      }, children)
    }


    // ==================== 语音设置面板 ====================

    /** 调接口的小工具：统一处理 JSON 与错误。 */
    async function apiJson(url, options) {
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`)
      return j
    }

    /**
     * 语音面板：开关、音量、声源管理、社区目录搜索、试听。
     *
     * 声源列表与社区目录都来自宿主，这里只做展示与交互。
     */
    function VoicePanel({ t, settings, onPatch, onCommit }) {
      const [voices, setVoices] = React.useState({ sources: [], currentId: '', readiness: {} })
      const [catalog, setCatalog] = React.useState([])
      const [voicesLib, setVoicesLib] = React.useState([])
      const [query, setQuery] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const audioRef = React.useRef(null)
      const voiceAudioRef = React.useRef(null)

      const reloadVoices = React.useCallback(async () => {
        try {
          const j = await apiJson(PATHS.voices)
          setVoices({ sources: j.sources ?? [], currentId: j.currentId ?? '', readiness: j.readiness ?? {} })
        } catch (e) { setNotice({ kind: 'err', text: `读取声源失败：${e.message}` }) }
      }, [])

      const searchCatalog = React.useCallback(async q => {
        try {
          const j = await apiJson(`${PATHS.catalog}?q=${encodeURIComponent(q)}`)
          setCatalog(j.items ?? [])
          setVoicesLib(j.voices ?? [])
        } catch (e) { setNotice({ kind: 'err', text: `搜索失败：${e.message}` }) }
      }, [])

      React.useEffect(() => { reloadVoices() }, [reloadVoices])
      React.useEffect(() => { searchCatalog('') }, [searchCatalog])

      const post = async (body, label) => {
        setBusy(label)
        setNotice(null)
        try {
          const j = await apiJson(PATHS.voices, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (j.sources) setVoices(v => ({ ...v, sources: j.sources, currentId: j.currentId ?? v.currentId }))
          await reloadVoices()
          return j
        } catch (e) {
          setNotice({ kind: 'err', text: e.message })
          return null
        } finally { setBusy('') }
      }

      /** 试听：合成后播放。 */
      const preview = async text => {
        setBusy('preview')
        setNotice(null)
        try {
          const j = await apiJson(PATHS.speak, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, lang: settings.voiceLang || 'auto' }),
          })
          if (!j.ok) throw new Error(j.message ?? '合成失败')

          // 手机自带语音走本地合成，没有音频文件，必须用 speechSynthesis 播放
          if (j.clientSide) {
            if (typeof window.speechSynthesis === 'undefined') {
              throw new Error('当前环境不支持系统语音（speechSynthesis 不可用）')
            }
            const utter = new window.SpeechSynthesisUtterance(j.text)
            if (j.voiceName) {
              const match = (window.speechSynthesis.getVoices() || []).find(v => v.name === j.voiceName)
              if (match) utter.voice = match
            }
            utter.rate = j.rate ?? 1
            utter.pitch = j.pitch ?? 1
            utter.volume = Math.min(1, Math.max(0, settings.voiceVolume))
            window.speechSynthesis.cancel()
            window.speechSynthesis.speak(utter)
            setNotice({ kind: 'ok', text: '已播放（系统语音）' })
            return
          }

          if (!audioRef.current) audioRef.current = new window.Audio()
          audioRef.current.src = j.url
          audioRef.current.volume = settings.voiceVolume
          const p = audioRef.current.play()
          if (p && p.catch) p.catch(() => setNotice({ kind: 'err', text: '浏览器阻止了播放，请再点一次' }))
          setNotice({ kind: 'ok', text: j.cached ? '已播放（缓存）' : '已播放' })
        } catch (e) {
          setNotice({ kind: 'err', text: e.message })
        } finally { setBusy('') }
      }

      const inputStyle = {
        width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px',
        borderRadius: 8, border: '1px solid rgba(0,0,0,.15)',
        background: 'transparent', color: 'inherit', fontFamily: 'inherit',
      }

      const current = voices.sources.find(s => s.id === voices.currentId) ?? null
      const currentReady = current ? voices.readiness[current.id] : null

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
        // 总开关
        h(Row, { key: 'on', label: t('menu.voice.enable'), hint: t('menu.voice.hint') },
          h(Toggle, {
            on: settings.voiceEnabled,
            label: t('menu.voice.enable'),
            onChange: v => { onPatch('voiceEnabled', v); onCommit({ ...settings, voiceEnabled: v }) },
          })),

        // 音量
        h(Row, { key: 'vol', label: t('menu.voice.volume') },
          h('input', {
            type: 'range', min: 0, max: 1, step: 0.05,
            value: settings.voiceVolume, style: { width: 118, accentColor: '#2fa37a' },
            onChange: e => onPatch('voiceVolume', Number(e.target.value)),
            onPointerUp: () => onCommit(settings),
          })),

        // 点击朗读 / 欢迎语
        h(Row, { key: 'click', label: t('menu.voice.onClick') },
          h(Toggle, {
            on: settings.speakOnClick,
            label: t('menu.voice.onClick'),
            onChange: v => { onPatch('speakOnClick', v); onCommit({ ...settings, speakOnClick: v }) },
          })),
        h(Row, { key: 'lang', label: t('menu.voice.lang2'), hint: t('menu.voice.lang2Hint') },
          h('select', {
            value: settings.voiceLang || 'auto',
            onChange: e => {
              onPatch('voiceLang', e.target.value)
              onCommit({ ...settings, voiceLang: e.target.value })
            },
            style: {
              fontSize: 12, padding: '5px 8px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,.15)', background: 'transparent',
              color: 'inherit', fontFamily: 'inherit',
            },
          }, [
            h('option', { key: 'auto', value: 'auto' }, t('menu.voice.langAuto')),
            h('option', { key: 'zh', value: 'zh' }, '中文'),
            h('option', { key: 'en', value: 'en' }, 'English'),
            h('option', { key: 'ja', value: 'ja' }, '日本語'),
            h('option', { key: 'ko', value: 'ko' }, '한국어'),
          ])),
        (() => {
          const cur = (voices.sources || []).find(v => v.id === voices.currentId)
          const want = settings.voiceLang || 'auto'
          if (!cur || want === 'auto') return null
          const supported = { baidu: ['zh', 'en'], zipvoice: ['zh', 'en'], local: [] }[cur.type]
          if (!supported || supported.includes(want)) return null
          return h('div', {
            key: 'langwarn',
            style: { fontSize: 10, color: '#b7791f', lineHeight: 1.4 },
          }, t('menu.voice.langWarn'))
        })(),
        h(Row, { key: 'cam', label: t('menu.voice.clickMode'), hint: t('menu.voice.clickModeHint') },
          h('select', {
            value: settings.clickAudioMode || 'auto',
            onChange: e => {
              onPatch('clickAudioMode', e.target.value)
              onCommit({ ...settings, clickAudioMode: e.target.value })
            },
            style: {
              fontSize: 12, padding: '5px 8px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,.15)', background: 'transparent',
              color: 'inherit', fontFamily: 'inherit',
            },
          }, [
            h('option', { key: 'auto', value: 'auto' }, t('menu.voice.modeAuto')),
            h('option', { key: 'voice', value: 'voice' }, t('menu.voice.modeVoice')),
            h('option', { key: 'sound', value: 'sound' }, t('menu.voice.modeSound')),
            h('option', { key: 'both', value: 'both' }, t('menu.voice.modeBoth')),
          ])),
        h(Row, { key: 'greet', label: t('menu.voice.greet') },
          h(Toggle, {
            on: settings.greetOnLoad,
            label: t('menu.voice.greet'),
            onChange: v => { onPatch('greetOnLoad', v); onCommit({ ...settings, greetOnLoad: v }) },
          })),

        // 当前声源
        h(Section, { key: 's-cur', title: t('menu.voice.sources') }),
        h('div', { key: 'cur', style: { fontSize: 12, opacity: 0.75, padding: '2px 0 6px' } },
          current
            ? `${t('menu.voice.current')}：${current.name}${currentReady && !currentReady.ok ? `（${currentReady.reason}）` : ''}`
            : t('menu.voice.none')),

        // 声源列表
        h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          voices.sources.length === 0
            ? [h('div', { key: 'empty', style: { fontSize: 11, opacity: 0.6 } }, t('menu.voice.empty'))]
            : voices.sources.map(src => {
                const ready = voices.readiness[src.id]
                const isCurrent = src.id === voices.currentId
                return h('div', {
                  key: src.id,
                  style: {
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 7px', borderRadius: 8,
                    border: '1px solid ' + (isCurrent ? '#2fa37a' : 'rgba(0,0,0,.1)'),
                    background: isCurrent ? 'rgba(47,163,122,.07)' : 'transparent',
                  },
                }, [
                  h('div', { key: 'n', style: { flex: 1, minWidth: 0 } }, [
                    h('div', {
                      key: 't',
                      style: {
                        fontSize: 12, fontWeight: isCurrent ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      },
                    }, src.name),
                    h('div', { key: 'd', style: { fontSize: 10, opacity: 0.55 } },
                      `${src.type}${ready && !ready.ok ? ` · ${ready.reason}` : ''}${src.hasKey ? ' · 已配置密钥' : ''}`),
                  ]),
                  !isCurrent ? h(GhostButton, {
                    key: 'sel',
                    onClick: () => post({ action: 'select', id: src.id }, 'select'),
                  }, t('menu.voice.use')) : null,
                  h(GhostButton, {
                    key: 'edit',
                    onClick: () => setEditing({ ...src }),
                  }, t('menu.voice.edit')),
                  h(GhostButton, {
                    key: 'del',
                    onClick: () => post({ action: 'delete', id: src.id }, 'delete'),
                  }, t('menu.voice.del')),
                ])
              })),

        // 试听
        h('div', { key: 'preview', style: { display: 'flex', gap: 6, marginTop: 6 } }, [
          h(GhostButton, {
            key: 'p1',
            accent: true,
            disabled: busy === 'preview' || !current,
            onClick: () => preview('你好呀，我是大肥鱼～'),
          }, busy === 'preview' ? t('menu.voice.working') : t('menu.voice.preview')),
        ]),

        // 社区目录
        h(Section, { key: 's-cat', title: t('menu.voice.catalog') }),
        h('div', { key: 'search', style: { display: 'flex', gap: 6, marginBottom: 4 } }, [
          h('input', {
            key: 'q',
            type: 'text',
            value: query,
            placeholder: t('menu.voice.searchPlaceholder'),
            onChange: e => setQuery(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') searchCatalog(query) },
            style: { ...inputStyle, flex: 1 },
          }),
          h(GhostButton, { key: 'go', onClick: () => searchCatalog(query) }, t('menu.voice.search')),
        ]),
        h('div', { key: 'cat', style: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' } },
          catalog.length === 0
            ? [h('div', { key: 'e', style: { fontSize: 11, opacity: 0.6 } }, t('menu.voice.noMatch'))]
            : catalog.map(item => h('div', {
                key: item.id,
                style: {
                  padding: '6px 8px', borderRadius: 8,
                  border: '1px solid rgba(0,0,0,.08)',
                },
              }, [
                h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
                  h('div', { key: 'n', style: { fontSize: 12, fontWeight: 600, flex: 1 } }, item.name),
                  item.needsKey ? h('span', {
                    key: 'k',
                    style: { fontSize: 9, padding: '0 4px', borderRadius: 4, background: 'rgba(245,158,11,.18)', color: '#b45309' },
                  }, t('menu.voice.needsKey')) : null,
                  h(GhostButton, {
                    key: 'add',
                    accent: true,
                    onClick: () => post({ action: 'addFromCatalog', catalogId: item.id }, 'add'),
                  }, t('menu.voice.add')),
                ]),
                h('div', { key: 'd', style: { fontSize: 10, opacity: 0.6, lineHeight: 1.4, marginTop: 2 } },
                  item.description),
                item.homepage ? h('div', { key: 'hp', style: { fontSize: 10, opacity: 0.5, marginTop: 2 } },
                  item.homepage) : null,
              ]))),

        // 音色库（社区音色，可按关键词搜索）
        h(Section, { key: 's-lib', title: t('menu.voice.library') }),
        h('div', { key: 'libhint', style: { fontSize: 10, opacity: 0.55, marginBottom: 4 } },
          t('menu.voice.libraryHint')),
        h('div', { key: 'lib', style: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' } },
          voicesLib.length === 0
            ? [h('div', { key: 'e', style: { fontSize: 11, opacity: 0.6 } }, t('menu.voice.noMatch'))]
            : voicesLib.map(v => h('div', {
                key: v.id,
                style: {
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px', borderRadius: 8,
                  border: '1px solid rgba(0,0,0,.08)',
                },
              }, [
                h('div', { key: 'n', style: { flex: 1, minWidth: 0 } }, [
                  h('div', {
                    key: 't',
                    style: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  }, v.name),
                  h('div', { key: 'd', style: { fontSize: 10, opacity: 0.5 } },
                    (v.tags || []).slice(0, 4).join(' · ')),
                ]),
                h(GhostButton, {
                  key: 'add',
                  accent: true,
                  onClick: () => post({ action: 'addFromCatalog', catalogId: v.id }, 'add'),
                }, t('menu.voice.add')),
              ]))),

        // 新增自定义声源
        h('div', { key: 'addnew', style: { marginTop: 6 } },
          h(GhostButton, {
            accent: true,
            onClick: () => setEditing({
              id: '', name: '', type: 'openai', baseUrl: '', apiKey: '', model: 'tts-1', voice: '', speed: 1,
            }),
          }, t('menu.voice.addCustom'))),

        // 编辑对话框
        editing ? h(SourceEditor, {
          key: 'editor',
          t,
          value: editing,
          onCancel: () => setEditing(null),
          onSave: async next => {
            const j = await post({ action: 'save', source: next }, 'save')
            if (j) setEditing(null)
          },
        }) : null,

        notice ? h('div', {
          key: 'nt',
          style: {
            fontSize: 11, marginTop: 4,
            color: notice.kind === 'err' ? '#c0392b' : '#1f7d5c',
          },
        }, notice.text) : null,
      ])
    }

    /** 声源编辑对话框：新增或修改。 */
    function SourceEditor({ t, value, onCancel, onSave }) {
      const [draft, setDraft] = React.useState(value)
      // 切换编辑对象时同步草稿，避免沿用上一个声源的值
      React.useEffect(() => { setDraft(value) }, [value?.id])
      const patch = (k, v) => setDraft(p => ({ ...p, [k]: v }))
      const field = (k, label, opts = {}) => h('label', {
        key: k,
        style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 },
      }, [
        h('span', { key: 'l', style: { opacity: 0.7 } }, label),
        h('input', {
          key: 'i',
          type: opts.password ? 'password' : 'text',
          value: draft[k] ?? '',
          placeholder: opts.placeholder ?? '',
          onChange: e => patch(k, e.target.value),
          style: {
            fontSize: 12, padding: '5px 8px', borderRadius: 8,
            border: '1px solid rgba(0,0,0,.15)', background: 'transparent',
            color: 'inherit', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
          },
        }),
      ])

      const types = ['webspeech', 'azure', 'volc', 'baidu', 'openai', 'template', 'local']

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        },
        onPointerDown: e => { if (e.target === e.currentTarget) onCancel() },
      }, h('div', {
        style: {
          width: '100%', maxWidth: 340, maxHeight: '80vh', overflowY: 'auto',
          background: 'var(--dsh-surface, #fff)', color: 'var(--dsh-text, #222)',
          borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
          fontFamily: 'system-ui, sans-serif',
        },
      }, [
        h('div', { key: 'h', style: { fontSize: 14, fontWeight: 700 } }, t('menu.voice.editorTitle')),
        h('label', { key: 'type', style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 } }, [
          h('span', { key: 'l', style: { opacity: 0.7 } }, t('menu.voice.type')),
          h('select', {
            key: 's',
            value: draft.type,
            onChange: e => patch('type', e.target.value),
            style: {
              fontSize: 12, padding: '5px 8px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,.15)', background: 'transparent',
              color: 'inherit', fontFamily: 'inherit',
            },
          }, types.map(x => h('option', { key: x, value: x }, x))),
        ]),
        field('name', t('menu.voice.name')),
        draft.type === 'baidu' ? field('lang', t('menu.voice.lang'), { placeholder: 'zh / en / jp' }) : null,
        draft.type === 'baidu' ? field('speed', t('menu.voice.speed'), { placeholder: '1-6' }) : null,
        draft.type === 'baidu' ? h('label', {
          key: 'per',
          style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 },
        }, [
          h('span', { key: 'l', style: { opacity: 0.7 } }, t('menu.voice.person')),
          h('select', {
            key: 's',
            value: String(draft.per ?? 0),
            onChange: e => patch('per', Number(e.target.value)),
            style: {
              fontSize: 12, padding: '5px 8px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,.15)', background: 'transparent',
              color: 'inherit', fontFamily: 'inherit',
            },
          }, [
            h('option', { key: 0, value: '0' }, '度小美（女声）'),
            h('option', { key: 106, value: '106' }, '度博文（男声）'),
          ]),
        ]) : null,
        draft.type === 'webspeech' ? h('div', {
          key: 'ws',
          style: { fontSize: 10, opacity: 0.6, lineHeight: 1.5 },
        }, t('menu.voice.webspeechHint')) : null,
        draft.type === 'webspeech' ? field('voiceName', t('menu.voice.voiceName'), { placeholder: t('menu.voice.voiceNameHint') }) : null,
        draft.type === 'webspeech' ? field('rate', t('menu.voice.speed'), { placeholder: '0.5 - 2' }) : null,
        draft.type === 'azure' ? field('region', t('menu.voice.region'), { placeholder: 'eastasia / eastus' }) : null,
        draft.type === 'azure' ? field('voice', 'voice', { placeholder: 'zh-CN-XiaoxiaoNeural' }) : null,
        draft.type === 'azure' ? field('apiKey', t('menu.voice.apiKey'), { password: true, placeholder: draft.hasKey ? t('menu.voice.keySaved') : '' }) : null,
        draft.type === 'volc' ? field('appId', 'AppId', { placeholder: '' }) : null,
        draft.type === 'volc' ? field('voice', 'voice', { placeholder: 'zh_female_cancan_mars_bigtts' }) : null,
        draft.type === 'volc' ? field('apiKey', 'Access Token', { password: true, placeholder: draft.hasKey ? t('menu.voice.keySaved') : '' }) : null,
        draft.type === 'openai' ? field('baseUrl', 'baseUrl', { placeholder: 'https://your-tts/v1' }) : null,
        draft.type === 'openai' ? field('voice', 'voice', { placeholder: 'zh-CN-XiaoxiaoNeural' }) : null,
        draft.type === 'openai' ? field('model', 'model', { placeholder: 'tts-1' }) : null,
        draft.type === 'openai'
          ? field('apiKey', t('menu.voice.apiKey'), { password: true, placeholder: draft.hasKey ? '已保存，留空则不修改' : '' })
          : null,
        draft.type === 'template' ? field('url', 'URL 模板', { placeholder: 'http://host/tts?text={text}&lang={lang}' }) : null,
        h('div', { key: 'hint', style: { fontSize: 10, opacity: 0.55, lineHeight: 1.5 } },
          t('menu.voice.placeholderHint')),
        h('div', { key: 'foot', style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } }, [
          h(GhostButton, { key: 'c', onClick: onCancel }, t('menu.voice.cancel')),
          h('button', {
            key: 's',
            type: 'button',
            onClick: () => onSave(draft),
            style: {
              fontSize: 12, padding: '6px 14px', borderRadius: 8,
              border: 'none', background: '#2fa37a', color: '#fff', fontWeight: 600, cursor: 'pointer',
            },
          }, t('menu.voice.save')),
        ]),
      ]))
    }

    // ==================== 菜单 ====================

    /** 长按打开的桌宠菜单。 */
    function PetMenu({ t, settings, onClose, onSettingsChange, onHide }) {
      const [draft, setDraft] = React.useState(settings)
      const [status, setStatus] = React.useState(null)
      const [uploading, setUploading] = React.useState('')
      // 当前生效的音效：{ source: 'builtin' | 'custom', uploaded: {...} | null }
      const [soundInfo, setSoundInfo] = React.useState(null)
      // null = 加载中；数组 = 已拿到列表（可能为空）
      const [models, setModels] = React.useState(null)
      const imageInputRef = React.useRef(null)
      const soundInputRef = React.useRef(null)
      const modelInputRef = React.useRef(null)

      React.useEffect(() => { setDraft(settings) }, [settings])

      /** 拉一次当前音效状态。 */
      const refreshSoundStatus = React.useCallback(async () => {
        try {
          const r = await fetch(PATHS.soundStatus, { credentials: 'same-origin' })
          const j = await r.json().catch(() => ({}))
          if (j && j.ok) setSoundInfo({ source: j.source, uploaded: j.uploaded ?? null })
        } catch { /* 读不到就不显示，不打断菜单 */ }
      }, [])

      React.useEffect(() => { refreshSoundStatus() }, [refreshSoundStatus])

      // 每次打开菜单都强制刷新一次模型列表（可能刚在别处上传/删除过）
      React.useEffect(() => {
        let alive = true
        fetchLive2DModels(true)
          .then(list => { if (alive) setModels(list) })
          .catch(() => { if (alive) setModels([]) })
        return () => { alive = false }
      }, [])

      // 动画素材清单：进菜单时强制重扫一次，方便用户刚放好素材就切过去
      const [animInfo, setAnimInfo] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        fetchAnimationManifest(true)
          .then(m => { if (alive) setAnimInfo(m) })
          .catch(() => { if (alive) setAnimInfo({ ok: false, reason: 'MANIFEST_FAILED' }) })
        return () => { alive = false }
      }, [])

      const patch = (key, value) => setDraft(prev => ({ ...prev, [key]: value }))

      const commit = async next => {
        setStatus(t('menu.saving'))
        try {
          const saved = await putSettings(next)
          onSettingsChange(saved)
          setStatus(t('menu.saved'))
          window.setTimeout(() => setStatus(null), 1400)
        } catch (error) {
          setStatus(`${t('menu.upload.fail')}: ${error?.message ?? error}`)
        }
      }

      const upload = async (file, kind) => {
        if (!file) return
        const path = kind === 'image' ? PATHS.customImage : PATHS.sound
        setUploading(kind)
        try {
          const r = await fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/octet-stream' },
            body: file,
          })
          const j = await r.json().catch(() => ({}))
          if (!r.ok || j.ok === false) throw new Error(j.message ?? `HTTP ${r.status}`)
          const next = kind === 'image'
            ? { ...draft, appearance: 'image', useCustomImage: true, customImageUrl: j.url }
            : { ...draft, soundEnabled: true, soundUrl: j.url }
          setDraft(next)
          await commit(next)
          // 上传成功后刷新「当前音效」显示
          if (kind === 'sound') await refreshSoundStatus()
        } catch (error) {
          setStatus(`${t('menu.upload.fail')}: ${error?.message ?? error}`)
        } finally {
          setUploading('')
        }
      }

      /** 移除自定义音效，回到内置合成音。 */
      const removeSound = async () => {
        try {
          const r = await fetch(PATHS.sound, { method: 'DELETE', credentials: 'same-origin' })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const next = { ...draft, soundUrl: '' }
          setDraft(next)
          await commit(next)
          await refreshSoundStatus()
          setStatus(t('menu.sound.removed'))
          window.setTimeout(() => setStatus(null), 1600)
        } catch (error) {
          setStatus(`${t('menu.upload.fail')}: ${error?.message ?? error}`)
        }
      }

      /** 上传 Live2D 模型 zip；成功后自动切到 Live2D 并选中新模型。 */
      const uploadModel = async file => {
        if (!file) return
        setUploading('live2d')
        setStatus(t('menu.live2d.uploading'))
        try {
          const r = await fetch(`${PATHS.live2dModels}?name=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/zip' },
            body: file,
          })
          const j = await r.json().catch(() => ({}))
          if (!r.ok || j.ok === false) throw new Error(j.message ?? `HTTP ${r.status}`)
          const list = await fetchLive2DModels(true)
          setModels(list)
          const next = { ...draft, appearance: 'live2d', live2dModel: j.model.id }
          setDraft(next)
          await commit(next)
          setStatus(t('menu.live2d.uploaded'))
          window.setTimeout(() => setStatus(null), 1600)
        } catch (error) {
          setStatus(`${t('menu.upload.fail')}: ${error?.message ?? error}`)
        } finally {
          setUploading('')
        }
      }

      /** 选中一个已上传模型。 */
      const chooseModel = async model => {
        const next = { ...draft, appearance: 'live2d', live2dModel: model.id }
        setDraft(next)
        await commit(next)
      }

      /** 删除一个模型；删的是当前模型时回退图片模式。 */
      const deleteModel = async model => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          const ok = window.confirm(t('menu.live2d.deleteConfirm', { name: model.name }))
          if (!ok) return
        }
        setUploading('live2d')
        try {
          const r = await fetch(`${PATHS.live2dModels}?id=${encodeURIComponent(model.id)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
          })
          const j = await r.json().catch(() => ({}))
          if (!r.ok || j.ok === false) throw new Error(j.message ?? `HTTP ${r.status}`)
          const list = await fetchLive2DModels(true)
          setModels(list)
          if (draft.live2dModel === model.id) {
            const next = { ...draft, appearance: 'image', live2dModel: '' }
            setDraft(next)
            await commit(next)
          }
          setStatus(t('menu.live2d.deleted'))
          window.setTimeout(() => setStatus(null), 1600)
        } catch (error) {
          setStatus(`${t('menu.upload.fail')}: ${error?.message ?? error}`)
        } finally {
          setUploading('')
        }
      }

      /** 试听当前音效：有自定义音就播文件，否则播合成音。 */
      const previewSound = () => {
        const volume = Math.min(1, Math.max(0, draft.soundVolume))
        if (draft.soundUrl) {
          try {
            const audio = new window.Audio(draft.soundUrl)
            audio.volume = volume
            const p = audio.play()
            if (p && typeof p.catch === 'function') p.catch(() => {})
          } catch { /* 忽略 */ }
          return
        }
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext
          if (!Ctx) return
          const ctx = new Ctx()
          const now = ctx.currentTime
          const osc = ctx.createOscillator()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(880, now)
          osc.frequency.exponentialRampToValueAtTime(520, now + 0.11)
          const gain = ctx.createGain()
          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.42 * volume, now + 0.008)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)
          osc.connect(gain).connect(ctx.destination)
          osc.start(now)
          osc.stop(now + 0.14)
          osc.onended = () => { try { ctx.close() } catch { /* 忽略 */ } }
        } catch { /* 忽略 */ }
      }

      /** 把字节数格式化成可读文本。 */
      const formatBytes = n => {
        const v = Number(n)
        if (!Number.isFinite(v) || v <= 0) return ''
        if (v < 1024) return `${v} B`
        if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
        return `${(v / 1024 / 1024).toFixed(1)} MB`
      }

      const slider = { width: 118, accentColor: '#2fa37a' }
      const inputStyle = {
        width: 110, fontSize: 12, padding: '5px 8px', borderRadius: 8,
        border: '1px solid rgba(0,0,0,.15)', background: 'transparent',
        color: 'inherit', fontFamily: 'inherit', boxSizing: 'border-box',
      }

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 70,
          background: 'rgba(0,0,0,.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16, animation: 'fishpet-fade .16s ease',
        },
        onPointerDown: e => { if (e.target === e.currentTarget) onClose() },
      }, h('div', {
        role: 'dialog',
        'aria-label': t('menu.title'),
        style: {
          width: '100%', maxWidth: 380, maxHeight: '82vh', overflowY: 'auto',
          background: 'var(--dsh-surface, #ffffff)', color: 'var(--dsh-text, #222)',
          borderRadius: 18, padding: '14px 18px 14px',
          boxShadow: '0 18px 48px rgba(0,0,0,.3)',
          animation: 'fishpet-fade .18s ease',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
      }, [
        h('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        }, [
          h('div', { key: 'ttl', style: { fontSize: 15, fontWeight: 700 } }, t('menu.title')),
          h('button', {
            key: 'hide', type: 'button', 'aria-label': t('menu.hidePet'),
            onClick: () => { onHide?.() },
            style: {
              border: 'none', background: 'transparent', fontSize: 12,
              lineHeight: 1, cursor: 'pointer', color: 'inherit', opacity: 0.45,
              padding: '4px 8px', marginRight: 6, borderRadius: 8,
            },
          }, t('menu.hidePet')),
          h('button', {
            key: 'x', type: 'button', 'aria-label': t('menu.close'), onClick: onClose,
            style: {
              border: 'none', background: 'transparent', fontSize: 20,
              lineHeight: 1, cursor: 'pointer', color: 'inherit', opacity: 0.5, padding: 4,
            },
          }, '×'),
        ]),

        // ---- 外观 ----
        h(Section, { key: 's1', title: t('menu.appearance') }),
        h(Row, { key: 'size', label: t('menu.size') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'r', type: 'range', min: 40, max: 200, step: 4,
              value: draft.size, style: slider,
              onChange: e => patch('size', Number(e.target.value)),
              onPointerUp: () => commit(draft),
            }),
            h('span', {
              key: 'v', style: { fontSize: 11, width: 36, textAlign: 'right', opacity: 0.7 },
            }, `${draft.size}px`),
          ])),
        h(Row, { key: 'scale', label: t('menu.scale'), hint: t('menu.scale.hint') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'r', type: 'range', min: 50, max: 260, step: 5,
              value: sizeToPercent(draft.size), style: slider,
              'aria-label': t('menu.scale'),
              onChange: e => patch('size', percentToSize(Number(e.target.value))),
              onPointerUp: () => commit(draft),
            }),
            h('span', {
              key: 'v', style: { fontSize: 11, width: 36, textAlign: 'right', opacity: 0.7 },
            }, `${sizeToPercent(draft.size)}%`),
          ])),
        h(Row, {
          key: 'lock',
          label: draft.locked ? t('menu.locked') : t('menu.lock'),
          hint: draft.locked ? t('menu.locked.hint') : t('menu.unlocked.hint'),
        },
          h(GhostButton, {
            accent: !draft.locked,
            onClick: () => {
              const next = { ...draft, locked: !draft.locked }
              setDraft(next)
              commit(next)
            },
          }, draft.locked ? t('menu.unlock') : t('menu.lock'))),
        h(Row, { key: 'opacity', label: t('menu.opacity') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'r', type: 'range', min: 0, max: 1, step: 0.02,
              value: draft.opacity, style: slider,
              onChange: e => patch('opacity', Number(e.target.value)),
              onPointerUp: () => commit(draft),
            }),
            h('span', {
              key: 'v', style: { fontSize: 11, width: 36, textAlign: 'right', opacity: 0.7 },
            }, `${Math.round(draft.opacity * 100)}%`),
          ])),

        // ---- 形象 ----
        h(Section, { key: 's2', title: t('menu.image') }),
        h(Row, { key: 'img', label: t('menu.image.builtin') },
          h(GhostButton, {
            onClick: () => {
              const next = { ...draft, appearance: 'image', useCustomImage: false }
              setDraft(next); commit(next)
            },
          }, draft.useCustomImage
            || draft.appearance === 'live2d'
            || draft.appearance === 'dynamic'
            || draft.appearance === 'animation'
            ? t('menu.switch')
            : t('menu.current'))),
        h(Row, { key: 'up', label: t('menu.image.upload'), hint: t('menu.image.hint') },
          h(GhostButton, {
            accent: true,
            disabled: uploading === 'image',
            onClick: () => imageInputRef.current?.click(),
          }, uploading === 'image' ? t('menu.uploading') : t('menu.pick'))),
        h('input', {
          key: 'f1', ref: imageInputRef, type: 'file',
          accept: 'image/png,image/jpeg,image/gif,image/webp',
          style: { display: 'none' },
          onChange: e => { upload(e.target.files?.[0], 'image'); e.target.value = '' },
        }),

        // ---- 动画形象（上游 dsh-pet 素材） ----
        h(Section, { key: 's-anim', title: t('menu.anim') }),
        h(Row, {
          key: 'animon',
          label: t('menu.anim.enable'),
          hint: t('menu.anim.hint'),
        },
          h(Toggle, {
            on: draft.appearance === 'animation',
            label: t('menu.anim.enable'),
            onChange: v => {
              const next = { ...draft, appearance: v ? 'animation' : 'image' }
              setDraft(next)
              commit(next)
            },
          })),
        h(Row, {
          key: 'animstatus',
          label: t('menu.anim.assets'),
          hint: animInfo === null
            ? t('menu.anim.loading')
            : animInfo.ok
              ? t('menu.anim.ready', { count: animInfo.count, expected: animInfo.expected })
              : t('menu.anim.missing'),
        },
          animInfo && animInfo.ok ? h('span', {
            style: {
              fontSize: 10, padding: '3px 8px', borderRadius: 999,
              color: '#1d7a58', background: 'rgba(47,163,122,.16)', whiteSpace: 'nowrap',
            },
          }, `${animInfo.count}/${animInfo.expected}`) : h('span', {
            style: {
              fontSize: 10, padding: '3px 8px', borderRadius: 999,
              color: '#b45309', background: 'rgba(245,158,11,.16)', whiteSpace: 'nowrap',
            },
          }, t('menu.anim.none'))),
        h(Row, { key: 'animrand', label: t('menu.anim.random'), hint: t('menu.anim.random.hint') },
          h(Toggle, {
            on: draft.animRandomEnabled !== false,
            label: t('menu.anim.random'),
            onChange: v => {
              const next = { ...draft, animRandomEnabled: v }
              setDraft(next)
              commit(next)
            },
          })),
        h(Row, { key: 'animclick', label: t('menu.anim.click'), hint: t('menu.anim.click.hint') },
          h(Toggle, {
            on: draft.animClickEnabled !== false,
            label: t('menu.anim.click'),
            onChange: v => {
              const next = { ...draft, animClickEnabled: v }
              setDraft(next)
              commit(next)
            },
          })),

        // ---- Live2D ----
        h(Section, { key: 's-live2d', title: t('menu.live2d') }),
        h(Row, {
          key: 'l2don',
          label: t('menu.live2d.enable'),
          hint: t('menu.live2d.hint'),
        },
          h(Toggle, {
            on: draft.appearance === 'live2d' && !!draft.live2dModel,
            label: t('menu.live2d.enable'),
            onChange: v => {
              if (v) {
                const pick = draft.live2dModel || (Array.isArray(models) && models[0] ? models[0].id : '')
                if (!pick) { setStatus(t('menu.live2d.selectFirst')); return }
                const next = { ...draft, appearance: 'live2d', live2dModel: pick }
                setDraft(next)
                commit(next)
              } else {
                const next = { ...draft, appearance: 'image' }
                setDraft(next)
                commit(next)
              }
            },
          })),
        h(Row, {
          key: 'l2dup',
          label: t('menu.live2d.models'),
          hint: models === null
            ? t('menu.live2d.loading')
            : models.length === 0
              ? t('menu.live2d.empty')
              : t('menu.live2d.uploadHint'),
        },
          h(GhostButton, {
            accent: true,
            disabled: uploading === 'live2d',
            onClick: () => modelInputRef.current?.click(),
          }, uploading === 'live2d' ? t('menu.uploading') : t('menu.live2d.upload'))),
        h('input', {
          key: 'f-l2d', ref: modelInputRef, type: 'file',
          accept: '.zip,application/zip,application/x-zip-compressed',
          style: { display: 'none' },
          onChange: e => { uploadModel(e.target.files?.[0]); e.target.value = '' },
        }),
        // 模型列表：点「使用」切换，点「删除」移除（带确认）
        Array.isArray(models) && models.length > 0 ? h('div', {
          key: 'l2dlist',
          style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 },
        }, models.map(model => {
          const active = draft.appearance === 'live2d' && draft.live2dModel === model.id
          const motionCount = Array.isArray(model.motions) ? model.motions.length : 0
          return h('div', {
            key: model.id,
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 10,
              border: '1px solid ' + (active ? 'rgba(47,163,122,.45)' : 'rgba(0,0,0,.10)'),
              background: active ? 'rgba(47,163,122,.08)' : 'transparent',
            },
          }, [
            h('div', {
              key: 'info',
              style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
            }, [
              h('div', {
                key: 'name',
                style: {
                  fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                },
              }, model.name),
              h('div', { key: 'meta', style: { fontSize: 10, opacity: 0.6 } },
                t('menu.live2d.meta', {
                  version: model.version || '4',
                  size: formatBytes(model.size),
                  motions: motionCount,
                })),
            ]),
            h('div', {
              key: 'ops',
              style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6 },
            }, [
              active
                ? h('span', {
                  key: 'tag',
                  style: {
                    fontSize: 10, padding: '3px 8px', borderRadius: 999,
                    color: '#1d7a58', background: 'rgba(47,163,122,.16)',
                    whiteSpace: 'nowrap',
                  },
                }, t('menu.live2d.inUse'))
                : h(GhostButton, { key: 'use', accent: true, onClick: () => chooseModel(model) },
                  t('menu.live2d.use')),
              h(GhostButton, { key: 'del', onClick: () => deleteModel(model) },
                t('menu.live2d.del')),
            ]),
          ])
        })) : null,
        h(Row, { key: 'l2dscale', label: t('menu.live2d.scale') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'r', type: 'range', min: 40, max: 250, step: 5,
              value: Math.round((draft.live2dScale || 1) * 100), style: slider,
              onChange: e => patch('live2dScale', Number(e.target.value) / 100),
              onPointerUp: () => commit(draft),
            }),
            h('span', {
              key: 'v', style: { fontSize: 11, width: 36, textAlign: 'right', opacity: 0.7 },
            }, `${Math.round((draft.live2dScale || 1) * 100)}%`),
          ])),
        h(Row, { key: 'l2dox', label: t('menu.live2d.offsetX') },
          h('input', {
            type: 'range', min: -50, max: 50, step: 5,
            value: Math.round((draft.live2dOffsetX || 0) * 100), style: slider,
            onChange: e => patch('live2dOffsetX', Number(e.target.value) / 100),
            onPointerUp: () => commit(draft),
          })),
        h(Row, { key: 'l2doy', label: t('menu.live2d.offsetY') },
          h('input', {
            type: 'range', min: -50, max: 50, step: 5,
            value: Math.round((draft.live2dOffsetY || 0) * 100), style: slider,
            onChange: e => patch('live2dOffsetY', Number(e.target.value) / 100),
            onPointerUp: () => commit(draft),
          })),
        h(Row, { key: 'l2dmotion', label: t('menu.live2d.motion') },
          h(Toggle, {
            on: draft.live2dMotion !== false,
            label: t('menu.live2d.motion'),
            onChange: v => { patch('live2dMotion', v); commit({ ...draft, live2dMotion: v }) },
          })),
        h(Row, { key: 'l2dlook', label: t('menu.live2d.lookAt') },
          h(Toggle, {
            on: draft.live2dLookAt !== false,
            label: t('menu.live2d.lookAt'),
            onChange: v => { patch('live2dLookAt', v); commit({ ...draft, live2dLookAt: v }) },
          })),

        // ---- 动态形象（伪 Live2D） ----
        h(Section, { key: 's-dyn', title: t('menu.dynamic') }),
        h(Row, {
          key: 'dynon',
          label: t('menu.dynamic.enable'),
          hint: t('menu.dynamic.hint'),
        },
          h(Toggle, {
            on: draft.appearance === 'dynamic',
            label: t('menu.dynamic.enable'),
            onChange: v => {
              const next = { ...draft, appearance: v ? 'dynamic' : 'image' }
              setDraft(next)
              commit(next)
            },
          })),
        h(Row, { key: 'dyni', label: t('menu.dynamic.intensity') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'r', type: 'range', min: 0, max: 150, step: 10,
              value: Math.round((draft.dynamicIntensity ?? 0.6) * 100), style: slider,
              onChange: e => patch('dynamicIntensity', Number(e.target.value) / 100),
              onPointerUp: () => commit(draft),
            }),
            h('span', {
              key: 'v', style: { fontSize: 11, width: 36, textAlign: 'right', opacity: 0.7 },
            }, `${Math.round((draft.dynamicIntensity ?? 0.6) * 100)}%`),
          ])),

        // ---- 音效 ----
        h(Section, { key: 's3', title: t('menu.sound') }),
        h(Row, { key: 'son', label: t('menu.sound.enable') },
          h(Toggle, {
            on: draft.soundEnabled,
            label: t('menu.sound.enable'),
            onChange: v => { patch('soundEnabled', v); commit({ ...draft, soundEnabled: v }) },
          })),
        // 当前音效：显示用的是内置合成音还是上传的文件，并可直接试听
        h(Row, {
          key: 'scur',
          label: t('menu.sound.current'),
          hint: draft.soundEnabled === false
            ? t('menu.sound.off')
            : soundInfo === null
              ? ''
              : soundInfo.source === 'custom'
                ? `${t('menu.sound.custom')} — ${t('menu.sound.custom.meta')
                  .replace('{type}', String(soundInfo.uploaded?.type ?? '').toUpperCase())
                  .replace('{size}', formatBytes(soundInfo.uploaded?.size))}`
                : t('menu.sound.builtin.hint'),
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
            h('span', {
              key: 'tag',
              style: {
                fontSize: 11, padding: '2px 8px', borderRadius: 999,
                background: soundInfo?.source === 'custom'
                  ? 'rgba(47,163,122,.16)'
                  : 'rgba(120,140,160,.16)',
                color: soundInfo?.source === 'custom' ? '#1d7a58' : '#5b6673',
                border: '1px solid ' + (soundInfo?.source === 'custom'
                  ? 'rgba(47,163,122,.35)'
                  : 'rgba(120,140,160,.30)'),
                whiteSpace: 'nowrap',
              },
            }, soundInfo === null
              ? '—'
              : soundInfo.source === 'custom'
                ? t('menu.sound.custom')
                : t('menu.sound.builtin')),
            h(GhostButton, { key: 'play', accent: true, onClick: previewSound }, t('menu.sound.try')),
            soundInfo?.source === 'custom'
              ? h(GhostButton, { key: 'rm', onClick: removeSound }, t('menu.sound.remove'))
              : null,
          ])),
        h(Row, { key: 'sup', label: t('menu.sound.upload'), hint: t('menu.sound.hint') },
          h(GhostButton, {
            accent: true,
            disabled: uploading === 'sound',
            onClick: () => soundInputRef.current?.click(),
          }, uploading === 'sound' ? t('menu.uploading') : t('menu.pick'))),
        h('input', {
          key: 'f2', ref: soundInputRef, type: 'file',
          accept: 'audio/mpeg,audio/wav,audio/ogg',
          style: { display: 'none' },
          onChange: e => { upload(e.target.files?.[0], 'sound'); e.target.value = '' },
        }),
        h(Row, { key: 'vol', label: t('menu.sound.volume') },
          h('input', {
            type: 'range', min: 0, max: 1, step: 0.05,
            value: draft.soundVolume, style: slider,
            onChange: e => patch('soundVolume', Number(e.target.value)),
            onPointerUp: () => commit(draft),
          })),

        // ---- 短语 ----
        h(Section, { key: 's4', title: t('menu.phrases') }),
        h('textarea', {
          key: 'ph',
          value: draft.phrases.join('\n'),
          placeholder: t('menu.phrases.placeholder'),
          rows: 4,
          onChange: e => patch('phrases', e.target.value.split('\n')),
          onBlur: () => commit(draft),
          style: {
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            fontSize: 12, lineHeight: 1.6, padding: 8, borderRadius: 10,
            border: '1px solid rgba(0,0,0,.15)', background: 'transparent',
            color: 'inherit', fontFamily: 'inherit',
          },
        }),
        h('div', { key: 'phh', style: { fontSize: 11, opacity: 0.6, marginTop: 4 } },
          t('menu.phrases.hint')),

        // ---- 天气 ----
        h(Section, { key: 's5', title: t('menu.weather') }),
        h(Row, { key: 'won', label: t('menu.weather.enable') },
          h(Toggle, {
            on: draft.weatherEnabled,
            label: t('menu.weather.enable'),
            onChange: v => { patch('weatherEnabled', v); commit({ ...draft, weatherEnabled: v }) },
          })),
        h(Row, { key: 'wcity', label: t('menu.weather.city') },
          h('input', {
            type: 'text', value: draft.weatherCity, maxLength: 32, style: inputStyle,
            onChange: e => patch('weatherCity', e.target.value),
            onBlur: () => commit(draft),
          })),

        // ---- 每日声源校准 ----
        h(Section, { key: 's-harvest', title: t('menu.harvest') }),
        h(HarvestPanel, {
          key: 'harvestpanel',
          t,
          draft,
          patch,
          commit,
          inputStyle,
          slider,
        }),

        // ---- 语音 ----
        h(Section, { key: 's-voice', title: t('menu.voice') }),
        h(VoicePanel, {
          key: 'voicepanel',
          t,
          settings: draft,
          onPatch: patch,
          onCommit: commit,
        }),

        // ---- 快捷键 ----
        h(Section, { key: 's6', title: t('menu.shortcut') }),
        h(Row, { key: 'sc', label: t('menu.shortcut'), hint: t('menu.shortcut.hint') },
          h('input', {
            type: 'text',
            value: draft.shortcut,
            maxLength: 32,
            placeholder: 'ctrl+shift+p',
            onChange: e => patch('shortcut', e.target.value),
            onBlur: () => {
              if (parseShortcut(draft.shortcut)) commit(draft)
              else setStatus(t('menu.shortcut.invalid'))
            },
            style: inputStyle,
          })),

        // ---- 底部 ----
        h('div', {
          key: 'foot',
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, marginTop: 16, paddingTop: 10,
            borderTop: '1px solid rgba(0,0,0,.08)',
          },
        }, [
          h(GhostButton, {
            key: 'reset',
            onClick: () => {
              const next = { ...SETTINGS_DEFAULTS }
              setDraft(next); commit(next)
            },
          }, t('menu.reset')),
          h('div', { key: 'st', style: { fontSize: 11, opacity: 0.65, flex: 1, textAlign: 'center' } },
            status ?? ''),
          h('button', {
            key: 'save', type: 'button', onClick: () => commit(draft),
            style: {
              fontSize: 12, padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
              border: 'none', background: '#2fa37a', color: '#fff', fontWeight: 600,
            },
          }, t('menu.save')),
        ]),
      ]))
    }

    // ==================== 每日声源校准 ====================

    /** 把总开关同步给宿主：关闭后服务端会暂停每日校准。 */
    async function syncPower(enabled) {
      try {
        await fetch(PATHS.power, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: enabled !== false }),
        })
      } catch { /* 离线时只影响本地显示 */ }
    }

    /** 一键关闭肥鱼：本地隐藏 + 通知宿主暂停后台任务。 */
    function turnOffFish() {
      enabledState.set(false)
      void syncPower(false)
    }

    /** 一键恢复。 */
    function turnOnFish() {
      enabledState.set(true)
      void syncPower(true)
    }

    /**
     * 校准通知条：贴在桌宠左下，跑完弹一次；旁边就是「关闭肥鱼」。
     * @param {{ t: Function, status: object|null, onAck: Function, onKill: Function, onOpenMenu: Function }} props
     */
    function HarvestBanner({ t, status, onAck, onKill, onOpenMenu }) {
      const [expanded, setExpanded] = React.useState(false)
      const [, forceTick] = React.useState(0)
      const running = status?.running === true
      React.useEffect(() => {
        if (!running) return undefined
        const timer = window.setInterval(() => forceTick(v => v + 1), 15000)
        return () => window.clearInterval(timer)
      }, [running])
      if (!status) return null
      const notification = status.notification || null
      if (!running && !notification) return null

      const level = running ? 'run' : (notification.level || 'ok')
      const palette = {
        ok: { fg: '#1f7d5c', bg: 'rgba(47,163,122,.10)', bd: 'rgba(47,163,122,.35)' },
        warn: { fg: '#8a6100', bg: 'rgba(214,158,46,.12)', bd: 'rgba(214,158,46,.38)' },
        error: { fg: '#a93226', bg: 'rgba(192,57,43,.10)', bd: 'rgba(192,57,43,.34)' },
        run: { fg: '#1f6f9c', bg: 'rgba(31,111,156,.10)', bd: 'rgba(31,111,156,.32)' },
      }[level] || { fg: '#1f7d5c', bg: 'rgba(47,163,122,.10)', bd: 'rgba(47,163,122,.35)' }

      const mins = running && status.startedAt
        ? Math.max(0, Math.round((Date.now() - status.startedAt) / 60000))
        : 0
      const title = running ? t('harvest.running') : t('harvest.title')
      const text = running
        ? t('menu.harvest.running', { time: `${mins} 分钟` })
        : String(notification?.text ?? '')

      const smallBtn = { fontSize: 11, padding: '4px 8px', borderRadius: 7, cursor: 'pointer', border: '1px solid rgba(0,0,0,.14)', background: 'transparent', color: 'inherit' }

      return h('div', {
        key: 'harvest-banner',
        role: 'status',
        style: {
          position: 'fixed', left: 10, top: 64, width: 232, zIndex: 2147482000,
          background: 'rgba(255,255,255,.96)', color: '#1f2933',
          border: `1px solid ${palette.bd}`, borderRadius: 12,
          boxShadow: '0 6px 22px rgba(0,0,0,.14)', padding: '9px 10px',
          fontSize: 12, lineHeight: 1.45, backdropFilter: 'blur(6px)',
        },
      }, [
        h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 } }, [
          h('span', {
            key: 'dot',
            style: {
              width: 7, height: 7, borderRadius: '50%', background: palette.fg,
              display: 'inline-block', flex: '0 0 auto',
            },
          }),
          h('span', { key: 't', style: { fontWeight: 700, color: palette.fg, flex: 1, minWidth: 0 } }, title),
          h('button', {
            key: 'x', type: 'button', onClick: onAck,
            'aria-label': t('harvest.gotIt'), title: t('harvest.gotIt'),
            style: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, lineHeight: 1, color: '#8a949e', padding: 0 },
          }, '×'),
        ]),
        h('div', { key: 'b', style: { fontSize: 12, color: '#33404d' } }, text),
        expanded && notification?.detail
          ? h('div', { key: 'd', style: { fontSize: 11, opacity: 0.72, marginTop: 3, whiteSpace: 'pre-wrap' } }, notification.detail)
          : null,
        h('div', { key: 'a', style: { display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' } }, [
          running
            ? h('button', { key: 'menu', type: 'button', onClick: onOpenMenu, style: smallBtn }, t('menu.harvest'))
            : (notification?.detail
              ? h('button', {
                  key: 'detail', type: 'button',
                  onClick: () => setExpanded(v => !v),
                  style: smallBtn,
                }, expanded ? t('harvest.hideDetail') : t('harvest.detail'))
              : null),
          h('button', {
            key: 'kill', type: 'button', onClick: onKill,
            style: { ...smallBtn, color: '#a93226', borderColor: 'rgba(192,57,43,.35)' },
          }, t('harvest.closeFish')),
          running ? null : h('button', { key: 'ok', type: 'button', onClick: onAck, style: smallBtn }, t('harvest.gotIt')),
        ]),
      ])
    }

    /**
     * 菜单里的校准面板：开关、时间、关键词、阈值、基准、立即跑。
     * 自己拉状态，不依赖父组件传参，避免菜单状态互相牵扯。
     */
    function HarvestPanel({ t, draft, patch, commit, inputStyle, slider }) {
      const [status, setStatus] = React.useState(null)
      const [anchorInput, setAnchorInput] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')

      const refresh = React.useCallback(async () => {
        try {
          const j = await apiJson(PATHS.harvest)
          setStatus(j)
        } catch { /* 菜单里读不到就先空着 */ }
      }, [])

      React.useEffect(() => {
        refresh()
        const timer = window.setInterval(refresh, 20000)
        return () => window.clearInterval(timer)
      }, [refresh])

      const runNow = async () => {
        setBusy('run')
        try {
          await apiJson(PATHS.harvest, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'run' }),
          })
          setMsg(t('menu.harvest.runningHint'))
          await refresh()
        } catch (error) {
          setMsg(String(error?.message ?? error))
        } finally { setBusy('') }
      }

      const setAnchor = async () => {
        const input = anchorInput.trim()
        if (!input) return
        setBusy('anchor')
        setMsg('')
        try {
          const out = await apiJson(PATHS.harvest, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'anchor', input }),
          })
          if (out.ok !== true) throw new Error(out.message ?? '抽取基准失败')
          setMsg(`已设为基准：${out.anchor?.title ?? input}`)
          setAnchorInput('')
          await refresh()
        } catch (error) {
          setMsg(String(error?.message ?? error))
        } finally { setBusy('') }
      }

      const st = status || {}
      const anchor = st.anchor
      const anchorLabel = anchor
        ? t('menu.harvest.anchorUsing', {
            name: anchor.source === 'custom'
              ? `${t('menu.harvest.anchorCustom')}${anchor.title ? ' · ' + anchor.title : ''}`
              : t('menu.harvest.anchorVoice'),
          })
        : t('menu.harvest.anchorNone')
      const lastText = st.lastRunAt
        ? t('menu.harvest.lastRun', { when: formatDateTime(st.lastRunAt) })
        : t('menu.harvest.never')
      const report = st.lastReport
      const reportText = report
        ? `${report.candidates?.length ?? 0} 段达标 · ${report.applied?.length ?? 0} 个新声源 · ${formatElapsed(report.elapsedSec)}`
        : t('menu.harvest.noResult')

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
        h(Row, { key: 'en', label: t('menu.harvest.enable'), hint: t('menu.harvest.hint') },
          h(Toggle, {
            on: draft.harvestEnabled !== false,
            label: t('menu.harvest.enable'),
            onChange: v => { patch('harvestEnabled', v); commit({ ...draft, harvestEnabled: v }) },
          })),
        h(Row, { key: 'at', label: t('menu.harvest.at') },
          h('input', {
            type: 'time', value: draft.harvestAt, style: inputStyle,
            onChange: e => patch('harvestAt', e.target.value),
            onBlur: () => commit(draft),
          })),
        h(Row, { key: 'kw', label: t('menu.harvest.keywords'), hint: t('menu.harvest.keywordsHint') },
          h('textarea', {
            value: draft.harvestKeywords,
            rows: 2,
            maxLength: 200,
            style: { ...inputStyle, resize: 'vertical', lineHeight: 1.4 },
            onChange: e => patch('harvestKeywords', e.target.value),
            onBlur: () => commit(draft),
          })),
        h(Row, { key: 'budget', label: t('menu.harvest.budget') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'r', type: 'range', min: 5, max: 60, step: 5, style: slider,
              value: Number(draft.harvestBudgetMin) || 20,
              onChange: e => patch('harvestBudgetMin', Number(e.target.value)),
              onPointerUp: () => commit(draft),
            }),
            h('span', { key: 'v', style: { fontSize: 11, width: 52, textAlign: 'right', opacity: 0.7 } },
              t('menu.harvest.minutes', { n: Number(draft.harvestBudgetMin) || 20 })),
          ])),
        h(Row, { key: 'sim', label: t('menu.harvest.minSim'), hint: t('menu.harvest.minSimHint') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'r', type: 'range', min: 40, max: 95, step: 1, style: slider,
              value: Math.round((Number(draft.harvestMinSim) || 0.65) * 100),
              onChange: e => patch('harvestMinSim', Number(e.target.value) / 100),
              onPointerUp: () => commit(draft),
            }),
            h('span', { key: 'v', style: { fontSize: 11, width: 44, textAlign: 'right', opacity: 0.7 } },
              `${Math.round((Number(draft.harvestMinSim) || 0.65) * 100)}%`),
          ])),
        h(Row, { key: 'auto', label: t('menu.harvest.autoAdd'), hint: t('menu.harvest.autoAddHint') },
          h(Toggle, {
            on: draft.harvestAutoAdd !== false,
            label: t('menu.harvest.autoAdd'),
            onChange: v => { patch('harvestAutoAdd', v); commit({ ...draft, harvestAutoAdd: v }) },
          })),
        h(Row, { key: 'anchor', label: t('menu.harvest.anchor'), hint: t('menu.harvest.anchorHint') },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('div', { key: 'l', style: { fontSize: 11, opacity: 0.72 } }, anchorLabel),
            h('div', { key: 'row', style: { display: 'flex', gap: 6 } }, [
              h('input', {
                key: 'i', type: 'text', value: anchorInput, placeholder: 'BV1xxxxxxxxx',
                maxLength: 200, style: { ...inputStyle, flex: 1 },
                onChange: e => setAnchorInput(e.target.value),
              }),
              h(GhostButton, {
                key: 'b', accent: true, disabled: busy === 'anchor',
                onClick: setAnchor,
              }, busy === 'anchor' ? t('menu.uploading') : t('menu.harvest.anchorSet')),
            ]),
          ])),
        h(Row, { key: 'stat', label: t('menu.harvest.result'), hint: `${lastText} · ${reportText}` },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
            status?.running
              ? h('span', { key: 'r', style: { fontSize: 11, color: '#1f6f9c' } }, t('menu.harvest.running', { time: '…' }))
              : h(GhostButton, { key: 'run', accent: true, disabled: busy === 'run', onClick: runNow }, t('menu.harvest.run')),
          ])),
        msg
          ? h('div', { key: 'msg', style: { fontSize: 11, opacity: 0.75, paddingTop: 2 } }, msg)
          : null,
        h('div', { key: 'hint', style: { fontSize: 11, opacity: 0.55, paddingTop: 2 } }, t('menu.harvest.notify')),
      ])
    }

    /** 时间戳 → 本地「今天 10:32 / 10-17 09:10」。 */
    function formatDateTime(ts) {
      const n = Number(ts)
      if (!Number.isFinite(n) || n <= 0) return ''
      const d = new Date(n)
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const isToday = d.toDateString() === new Date().toDateString()
      if (isToday) return `${hh}:${mm}`
      return `${d.getMonth() + 1}-${d.getDate()} ${hh}:${mm}`
    }

    /** 秒 → 「1 分 20 秒」，与宿主 lib/harvest.js 的口径一致。 */
    function formatElapsed(sec) {
      const n = Number(sec)
      if (!Number.isFinite(n) || n <= 0) return '0 秒'
      const total = Math.round(n)
      const m = Math.floor(total / 60)
      const s = total % 60
      if (m <= 0) return `${s} 秒`
      return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`
    }

    // ==================== 桌宠主体 ====================

    /**
     * 桌宠悬浮组件（挂在 shell.overlay 槽）。
     *
     * 交互：
     *  - 单击 → 摸摸：弹一下、随机撒娇语、可选音效
     *  - 长按 500ms → 打开菜单
     *  - 拖动 → 移动位置（记住）
     */
    function FishPet({ t }) {
      const [prefs, setPrefs] = React.useState(loadPrefs)
      const globallyEnabled = useEnabled()
      const [settings, setSettings] = React.useState(SETTINGS_DEFAULTS)
      const [state, setState] = React.useState({ status: 'idle', balance: null, error: null })
      const [weather, setWeather] = React.useState(null)
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [petted, setPetted] = React.useState(null)
      // 点击计数：动画形象用它重播「点击回应」（同一句台词连点也要有反馈）
      const [pettedTick, setPettedTick] = React.useState(0)
      const [flash, setFlash] = React.useState(null)
      const [imgError, setImgError] = React.useState(false)
      // 语音失败时给可见提示：不能只 console，手机上看不到
      const [voiceHint, setVoiceHint] = React.useState(null)
      const voiceUnlockRef = React.useRef(false)
      const lastVoiceUrlRef = React.useRef(null)
      const [live2dError, setLive2dError] = React.useState(null)
      const [dynamicError, setDynamicError] = React.useState(null)
      const [animError, setAnimError] = React.useState(null)
      // 是否正在拖动桌宠（动画形象据此播「被拎起」动作）
      const [dragging, setDragging] = React.useState(false)
      // 每日声源校准：状态（含跑完的通知）与轮询
      const [harvestStatus, setHarvestStatus] = React.useState(null)
      const [anchor, setAnchor] = React.useState(null)
      const cardRef = React.useRef(null)
      const lastTapRef = React.useRef(0)
      // 缩放手势在 pointerup 里需要拿到最新设置（闭包里的 settings 可能是旧值）
      const settingsRef = React.useRef(settings)
      settingsRef.current = settings

      const dragRef = React.useRef(null)
      const longPressRef = React.useRef(null)
      const movedRef = React.useRef(false)
      const resizeRef = React.useRef(null)
      const lockedPointerRef = React.useRef(null)
      const clampingRef = React.useRef(false)
      // 双指捏合：记录每根手指的当前坐标，以及捏合起始时的两指距离与尺寸
      const touchPointsRef = React.useRef(new Map())
      const pinchRef = React.useRef(null)
      // 是否正在拖动缩放把手（仅用于把手高亮的视觉反馈）
      const [resizing, setResizing] = React.useState(false)
      const [pinching, setPinching] = React.useState(false)
      const prevTotalRef = React.useRef(null)
      const audioRef = React.useRef(null)
      // 语音朗读用的独立 Audio 元素（与点击音效分开，避免互相覆盖）
      const voiceAudioRef = React.useRef(null)
      // 内置合成音的 AudioContext（懒创建，随组件存活）
      const audioCtxRef = React.useRef(null)

      React.useEffect(() => { ensureStyles() }, [])

      // 把「关闭肥鱼」的总开关同步给宿主，让后台校准也一起停
      React.useEffect(() => {
        void syncPower(enabledState.get())
      }, [])

      // 校准状态轮询：跑完弹提醒；关闭肥鱼时不再轮询
      React.useEffect(() => {
        if (!globallyEnabled) return undefined
        let alive = true
        const pull = async () => {
          try {
            const j = await apiJson(PATHS.harvest)
            if (alive) setHarvestStatus(j)
          } catch { /* 读不到就保持上一次状态 */ }
        }
        pull()
        const timer = window.setInterval(pull, 20000)
        return () => { alive = false; window.clearInterval(timer) }
      }, [globallyEnabled])

      /** 确认（并清掉）校准通知。 */
      const ackHarvest = async () => {
        setHarvestStatus(prev => (prev ? { ...prev, notification: null } : prev))
        try {
          await apiJson(PATHS.harvest, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'ack' }),
          })
        } catch { /* 离线时只清本地 */ }
      }

      /** 通知条上的「关闭肥鱼」：先确认通知，再一键关闭。 */
      const killFish = () => {
        ackHarvest()
        turnOffFish()
      }

      // 桌宠位置变化时更新锚点，供气泡夹取用
      React.useLayoutEffect(() => {
        const el = cardRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        setAnchor({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
        // 放大后可能长出屏幕底部：把 top 往上收，保证整只桌宠留在视口内
        const overflow = r.bottom - window.innerHeight
        if (overflow > 0 && !clampingRef.current) {
          const targetTop = Math.max(0, prefs.top - overflow)
          if (Math.abs(targetTop - prefs.top) >= 1) {
            clampingRef.current = true
            setPrefs(prev => {
              const next = { ...prev, top: targetTop }
              savePrefs(next)
              return next
            })
          }
        } else {
          clampingRef.current = false
        }
      }, [prefs.right, prefs.top, settings.size, petted, menuOpen])

      React.useEffect(() => {
        let alive = true
        fetchSettings().then(s => { if (alive) setSettings(s) })
        return () => { alive = false }
      }, [])

      // 切换外观/模型后清掉上一次的加载失败状态，允许重新尝试
      React.useEffect(() => {
        setLive2dError(null)
        setDynamicError(null)
        setAnimError(null)
      }, [settings.appearance, settings.live2dModel, settings.dynamicIntensity])

      // 全局快捷键：打开/关闭桌宠菜单（默认 Ctrl/Cmd+Shift+P）
      React.useEffect(() => {
        const sc = parseShortcut(settings.shortcut) ?? DEFAULT_SHORTCUT
        const onKey = e => {
          if (!matchShortcut(e, sc)) return
          // 不抢输入框里的按键
          const tag = e.target && e.target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return
          e.preventDefault()
          setMenuOpen(v => !v)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [settings.shortcut])

      const refresh = React.useCallback(async () => {
        if (typeof fetch !== 'function') return
        setState(prev => ({ ...prev, status: 'loading' }))
        try {
          const response = await fetch(PATHS.balance, {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          if (!response.ok) {
            setState({ status: 'error', balance: null, error: `HTTP ${response.status}` })
            return
          }
          const result = await response.json()
          if (result && result.ok) {
            const now = Number.parseFloat(result.total)
            const prev = prevTotalRef.current
            if (Number.isFinite(now) && Number.isFinite(prev) && Math.abs(now - prev) >= 0.005) {
              setFlash(now < prev ? 'down' : 'up')
              window.setTimeout(() => setFlash(null), 1600)
            }
            if (Number.isFinite(now)) prevTotalRef.current = now
            setState({ status: 'ready', balance: result, error: null })
          } else {
            setState({
              status: result?.code === 'MISSING_API_KEY' ? 'noKey' : 'error',
              balance: null,
              error: result?.message ?? null,
            })
          }
        } catch (error) {
          setState({ status: 'error', balance: null, error: String(error?.message ?? error) })
        }
      }, [])

      const refreshWeather = React.useCallback(async () => {
        if (typeof fetch !== 'function') return
        try {
          const r = await fetch(PATHS.weather, { credentials: 'same-origin', cache: 'no-store' })
          const j = await r.json()
          setWeather(j && j.ok ? j : null)
        } catch {
          setWeather(null)
        }
      }, [])

      React.useEffect(() => {
        refresh()
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') refresh()
        }, BALANCE_POLL_MS)
        const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [refresh])

      React.useEffect(() => {
        if (!settings.weatherEnabled) { setWeather(null); return }
        refreshWeather()
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') refreshWeather()
        }, WEATHER_POLL_MS)
        return () => window.clearInterval(timer)
      }, [settings.weatherEnabled, settings.weatherCity, refreshWeather])


      /**
       * 内置点击音：用 Web Audio 现场合成，不依赖任何外部文件。
       *
       * 音色设计：一个短促的下滑正弦「啵」——起音高频、快速衰减，
       * 听感接近「戳一下小鱼」的反馈，足够轻，连点不刺耳。
       *
       * 为什么不用音频文件：内置资源要随插件分发，体积和授权都要考虑；
       * 合成音零体积、可调、无版权问题。用户上传自定义音效后走文件那条路。
       */
      const playBuiltinSound = React.useCallback(() => {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext
          if (!Ctx) return
          if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
          const ctx = audioCtxRef.current
          // 首次手势后才允许出声：正在 suspended 时立即恢复
          if (ctx.state === 'suspended') ctx.resume().catch(() => {})
          const now = ctx.currentTime
          const volume = Math.min(1, Math.max(0, settings.soundVolume))

          // 主音：880Hz → 520Hz 的快速下滑，120ms 指数衰减
          const osc = ctx.createOscillator()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(880, now)
          osc.frequency.exponentialRampToValueAtTime(520, now + 0.11)

          const gain = ctx.createGain()
          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.42 * volume, now + 0.008)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)

          osc.connect(gain).connect(ctx.destination)
          osc.start(now)
          osc.stop(now + 0.14)
        } catch { /* 浏览器不支持或被策略拦截：静默失败，不打断互动 */ }
      }, [settings.soundVolume])

      /**
       * 在用户的点击手势里「解锁」音频元素。
       *
       * 为什么需要：浏览器/WebView 只允许在用户手势期间开始播放。点击桌宠时
       * 要等合成返回（本地克隆可能 3-5 秒），手势早已过期，play() 会被拒绝，
       * 表现就是「点了没声音」。先用一段静音把元素激活，之后再播放就不会被拦。
       */
      const unlockVoiceAudio = React.useCallback(() => {
        if (voiceUnlockRef.current) return
        // 44 字节的空白 WAV
        const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA='
        try {
          if (!voiceAudioRef.current) voiceAudioRef.current = new window.Audio()
          const a = voiceAudioRef.current
          a.src = SILENT
          a.volume = 0
          const p = a.play()
          if (p && typeof p.then === 'function') {
            p.then(() => {
              a.pause()
              a.currentTime = 0
              a.volume = Math.min(1, Math.max(0, settings.voiceVolume))
              voiceUnlockRef.current = true
            }).catch(() => { /* 解锁失败下次再试 */ })
          } else {
            voiceUnlockRef.current = true
          }
        } catch { /* ignore */ }
        // 顺便解锁 WebAudio（内置音效走它）
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext
          if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx()
          if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => {})
          }
        } catch { /* ignore */ }
      }, [settings.voiceVolume])

      /**
       * 停掉当前所有正在播放的声音。
       *
       * 点击时可能同时存在「点击音效」和「语音朗读」两路音频，
       * 连点时如果不先停，会叠成一片噪音。
       */
      const stopAllAudio = React.useCallback(() => {
        try {
          if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
        } catch { /* ignore */ }
        try {
          if (voiceAudioRef.current) { voiceAudioRef.current.pause(); voiceAudioRef.current.currentTime = 0 }
        } catch { /* ignore */ }
        try {
          if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel()
        } catch { /* ignore */ }
      }, [])

      const playSound = React.useCallback(() => {
        if (!settings.soundEnabled) return
        // 没有自定义音效时用内置合成音，保证开箱即有声
        if (!settings.soundUrl) {
          playBuiltinSound()
          return
        }
        try {
          if (!audioRef.current || String(audioRef.current.src).indexOf(settings.soundUrl) < 0) {
            audioRef.current = new window.Audio(settings.soundUrl)
          }
          audioRef.current.volume = Math.min(1, Math.max(0, settings.soundVolume))
          audioRef.current.currentTime = 0
          const p = audioRef.current.play()
          if (p && typeof p.catch === 'function') p.catch(() => {})
          // 返回元素供调用方同步气泡时长；内置合成音没有元素，返回 null
          return audioRef.current
        } catch {
          return null
        }
      }, [settings.soundEnabled, settings.soundUrl, settings.soundVolume, playBuiltinSound])

      /**
       * 等音频真正可以完整播放再返回。
       *
       * 为什么需要：直接 play() 时浏览器可能只缓冲了一点就开始播，
       * 网络慢或本地克隆的 WAV 较大时会在中途卡住甚至截断，
       * 听起来就是「话说一半没声了」。宁可多等一两秒，也要播完整。
       *
       * @param {HTMLAudioElement} audio
       * @param {number} timeoutMs 最长等待时间，超时也照常播放
       * @returns {Promise<{ready:boolean, reason?:string}>}
       */
      const waitAudioReady = (audio, timeoutMs = 12000) => new Promise(resolve => {
        let settled = false
        const finish = result => {
          if (settled) return
          settled = true
          cleanup()
          resolve(result)
        }
        const onReady = () => {
          // 偶尔 canplaythrough 会给 duration=Infinity（流式），这时用 loadedmetadata 兜底
          if (Number.isFinite(audio.duration) && audio.duration <= 0) {
            finish({ ready: false, reason: '音频时长为 0，文件可能没生成完整' })
            return
          }
          finish({ ready: true })
        }
        const onError = () => finish({ ready: false, reason: '音频加载失败' })
        const timer = window.setTimeout(() => {
          // 超时不算失败：可能只是网速慢，让它边下边播
          finish({ ready: true, reason: 'timeout' })
        }, timeoutMs)
        function cleanup() {
          window.clearTimeout(timer)
          try {
            audio.removeEventListener('canplaythrough', onReady)
            audio.removeEventListener('loadeddata', onReady)
            audio.removeEventListener('error', onError)
          } catch { /* ignore */ }
        }
        try {
          audio.addEventListener('canplaythrough', onReady)
          audio.addEventListener('loadeddata', onReady)
          audio.addEventListener('error', onError)
        } catch { /* ignore */ }
        // 已经缓冲好了就别等事件
        if (audio.readyState >= 3) { onReady(); return }
        try { audio.load() } catch { /* ignore */ }
      })

      /** 朗读一段文本（走宿主 TTS）。失败静默，不打断摸摸动画。 */
      const speakText = React.useCallback(async text => {
        if (!settings.voiceEnabled || !text) return null
        try {
          const r = await fetch(PATHS.speak, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          const j = await r.json().catch(() => ({}))
          if (!j.ok) {
            // 宿主明确拒绝（未开语音、声源未就绪、合成失败等）也要让用户看见
            setVoiceHint(j.message || j.code || '语音不可用')
            window.setTimeout(() => setVoiceHint(null), 4000)
            return null
          }

          // 本地合成：用手机自带语音引擎，不产生音频文件
          if (j.clientSide) {
            if (typeof window.speechSynthesis === 'undefined' || typeof window.SpeechSynthesisUtterance === 'undefined') {
              return null
            }
            const utter = new window.SpeechSynthesisUtterance(j.text)
            if (j.voiceName) {
              const match = (window.speechSynthesis.getVoices() || []).find(v => v.name === j.voiceName)
              if (match) utter.voice = match
            }
            utter.rate = j.rate ?? 1
            utter.pitch = j.pitch ?? 1
            utter.volume = Math.min(1, Math.max(0, settings.voiceVolume))
            // 语种标签决定系统用哪种语言朗读
            if (j.lang) utter.lang = j.lang
            window.speechSynthesis.cancel()
            window.speechSynthesis.speak(utter)
            return utter
          }

          if (!j.url) {
            setVoiceHint('合成结果没有音频地址')
            window.setTimeout(() => setVoiceHint(null), 4000)
            return null
          }
          if (!voiceAudioRef.current) voiceAudioRef.current = new window.Audio()
          const audio = voiceAudioRef.current
          audio.src = j.url
          audio.preload = 'auto'
          lastVoiceUrlRef.current = j.url
          audio.volume = Math.min(1, Math.max(0, settings.voiceVolume))

          // 先等音频能完整播放再开声，宁可有延迟也不要播一半断掉
          const ready = await waitAudioReady(audio, 12000)
          if (!ready.ready) {
            setVoiceHint(ready.reason || '音频没能加载完整')
            window.setTimeout(() => setVoiceHint(null), 4000)
            return null
          }

          // 记录是否完整播完，供气泡收起时校验
          const expected = Number.isFinite(audio.duration) ? audio.duration : 0
          const checkComplete = () => {
            if (!expected) return
            // 明显没播到尾就结束了，说明中途被打断
            if (audio.currentTime + 0.4 < expected) {
              setVoiceHint('语音没有播完，可能被中断')
              window.setTimeout(() => setVoiceHint(null), 4000)
            }
          }
          try { audio.addEventListener('ended', checkComplete, { once: true }) } catch { /* ignore */ }

          const p = audio.play()
          if (p && typeof p.catch === 'function') {
            p.catch(err => {
              // NotAllowedError = 自动播放被拦；这时给一句可操作提示
              const name = err && err.name ? err.name : '播放失败'
              setVoiceHint(name === 'NotAllowedError' ? '播放被浏览器拦截，请再点一下桌宠' : ('播放失败：' + name))
              window.setTimeout(() => setVoiceHint(null), 4000)
            })
          }
          return audio
        } catch (error) {
          setVoiceHint('语音出错：' + String(error && error.message ? error.message : error))
          window.setTimeout(() => setVoiceHint(null), 4000)
          return null
        }
      }, [settings.voiceEnabled, settings.voiceVolume, settings.voiceLang])

      // 打开页面时的语音问候（每个会话只播一次）
      const greetedRef = React.useRef(false)
      React.useEffect(() => {
        if (greetedRef.current) return
        if (!settings.voiceEnabled || !settings.greetOnLoad) return
        greetedRef.current = true
        // 延迟一点，避开页面首屏渲染与浏览器的自动播放限制
        window.setTimeout(() => {
          const pool = settings.greetings.length > 0
            ? settings.greetings
            : '早上好呀，今天也要加油哦！'
          const text = Array.isArray(pool) ? pool[Math.floor(Math.random() * pool.length)] : pool
          speakText(text).then(audio => {
            if (!audio) return
            setPetted(text)
            window.setTimeout(() => setPetted(null), 4000)
          })
        }, 1200)
      }, [settings.voiceEnabled, settings.greetOnLoad, settings.greetings, speakText])

      const pet = React.useCallback(() => {
        const phrase = DEFAULT_PHRASES_PICK(settings.phrases)
        setPetted(phrase)
        setPettedTick(n => n + 1)
        // 连点时会叠音，先停掉上一轮
        stopAllAudio()

        // 点击音频模式：默认让「语音」和「音效」互斥，避免两路声音同时响
        const mode = settings.clickAudioMode || 'auto'
        const voiceOn = settings.voiceEnabled && settings.speakOnClick
        const soundOn = settings.soundEnabled
        let useVoice = false
        let useSound = false
        if (mode === 'both') {
          useVoice = voiceOn
          useSound = soundOn
        } else if (mode === 'voice') {
          useVoice = voiceOn
        } else if (mode === 'sound') {
          useSound = soundOn
        } else {
          // auto：能出声就算，语音优先；语音没开时才用音效
          if (voiceOn) useVoice = true
          else useSound = soundOn
        }

        const fallbackHide = () => window.setTimeout(() => setPetted(null), 2600)

        /** 把气泡收起绑到真正在播的那一路音频上。 */
        const track = speaker => {
          if (!speaker) { fallbackHide(); return }
          let done = false
          const finish = () => {
            if (done) return
            done = true
            window.setTimeout(() => setPetted(null), 400)
          }
          // Audio 元素用事件，SpeechSynthesisUtterance 用 onend
          if (typeof speaker.addEventListener === 'function') {
            speaker.addEventListener('ended', finish, { once: true })
            speaker.addEventListener('error', finish, { once: true })
          } else {
            speaker.onend = finish
            speaker.onerror = finish
          }
          // 兜底：本地克隆较慢，给足时间
          window.setTimeout(finish, 20000)
        }

        if (useVoice) {
          // 语音优先：气泡跟着语音走；音效只在 both 模式下一起响
          if (useSound) playSound()
          speakText(phrase).then(track)
          return
        }
        if (useSound) {
          track(playSound())
          return
        }
        // 两种声音都没触发：把原因说出来，避免「点了没反应又不知道为什么」
        setVoiceHint(
          !settings.voiceEnabled
            ? '语音未开启（菜单 → 语音）'
            : !settings.speakOnClick
              ? '「点击时朗读」未开启'
              : '没有可用的声音（检查音效/语音设置）'
        )
        window.setTimeout(() => setVoiceHint(null), 4000)
        fallbackHide()
      }, [
        settings.phrases, settings.voiceEnabled, settings.speakOnClick,
        settings.soundEnabled, settings.clickAudioMode,
        speakText, playSound, stopAllAudio, unlockVoiceAudio,
      ])

      /**
       * 两指距离。
       * @param {{x:number,y:number}} a
       * @param {{x:number,y:number}} b
       * @returns {number}
       */
      const distanceOf = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

      /**
       * 开始一次捏合：记下基准距离与基准尺寸。
       * 距离为 0（两指几乎重合）时给个下限，避免除零放大到无穷。
       */
      const beginPinch = () => {
        const pts = [...touchPointsRef.current.values()]
        if (pts.length < 2) return
        const d = distanceOf(pts[0], pts[1])
        pinchRef.current = {
          startDistance: Math.max(d, 1),
          startSize: settingsRef.current.size,
        }
        setPinching(true)
        // 捏合期间取消所有单指语义，否则会边拖边缩
        dragRef.current = null
        resizeRef.current = null
        movedRef.current = true
        if (longPressRef.current) {
          window.clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
        setResizing(false)
      }

      /**
       * 捏合进行中：按两指间距的变化比例调整尺寸。
       * 张开放大、捏合缩小，与系统图库的手感一致。
       */
      const updatePinch = () => {
        const pinch = pinchRef.current
        if (!pinch) return
        const pts = [...touchPointsRef.current.values()]
        if (pts.length < 2) return
        const d = distanceOf(pts[0], pts[1])
        const ratio = d / pinch.startDistance
        const min = Math.round(SIZE_BASE * SCALE_MIN_PERCENT / 100)
        const max = Math.round(SIZE_BASE * SCALE_MAX_PERCENT / 100)
        const nextSize = Math.min(max, Math.max(min, Math.round(pinch.startSize * ratio)))
        if (nextSize !== settingsRef.current.size) {
          setSettings(prev => (prev.size === nextSize ? prev : { ...prev, size: nextSize }))
        }
      }

      /** 结束捏合：持久化并清掉手势状态。 */
      const endPinch = persist => {
        if (!pinchRef.current) return
        pinchRef.current = null
        setPinching(false)
        if (persist) {
          putSettings(settingsRef.current).then(setSettings).catch(() => {})
        }
      }

      const onPointerDown = e => {
        if (e.button !== undefined && e.button !== 0) return

        // 在真实手势里立刻解锁音频：等合成返回再 play 会被浏览器拦
        unlockVoiceAudio()

        // 双指捏合优先于一切：记录触点，凑够两根就开始捏合。
        // 锁定只是锁位置，缩放不受影响；但记录触点仍要在锁定判断之前，
        // 否则锁定后第二根手指会被忽略、单指长按逻辑也会被误触发。
        if (e.pointerType === 'touch') {
          touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (touchPointsRef.current.size >= 2) {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            beginPinch()
            return
          }
        }

        // 锁定状态下不接管拖动，但仍允许长按/连点开菜单
        if (settings.locked) {
          if (e.target === e.currentTarget) {
            lockedPointerRef.current = { id: e.pointerId, at: Date.now() }
            longPressRef.current = window.setTimeout(() => {
              lockedPointerRef.current = null
              setMenuOpen(true)
              longPressRef.current = null
            }, LONG_PRESS_MS)
          }
          return
        }
        if (pinchRef.current) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        movedRef.current = false
        dragRef.current = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          right: prefs.right,
          top: prefs.top,
          at: Date.now(),
        }
        longPressRef.current = window.setTimeout(() => {
          if (!movedRef.current) {
            setMenuOpen(true)
            longPressRef.current = null
          }
        }, LONG_PRESS_MS)
      }

      const onPointerMove = e => {
        // 捏合中：更新触点坐标并按比例缩放
        if (touchPointsRef.current.has(e.pointerId)) {
          touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pinchRef.current) {
            e.preventDefault()
            updatePinch()
            return
          }
        }
        const drag = dragRef.current
        if (!drag || drag.id !== e.pointerId) return
        if (settings.locked) return
        const dx = drag.startX - e.clientX
        const dy = e.clientY - drag.startY
        if (Math.abs(dx) + Math.abs(dy) > MOVE_TOLERANCE) {
          movedRef.current = true
          // 动画形象：拖动时切到「被拎起悬空」动作
          setDragging(true)
          if (longPressRef.current) {
            window.clearTimeout(longPressRef.current)
            longPressRef.current = null
          }
        }
        // 右下角锚定：右上角坐标不变，高度变大时把 top 往上收，
        // 避免桌宠长高后长出屏幕底部。
        const maxTop = window.innerHeight - 90 - Math.max(0, settings.size - SIZE_BASE)
        setPrefs(prev => ({
          ...prev,
          // 允许贴到屏幕边缘（0 = 紧靠边框），只保留一点点可抓面积
          right: Math.max(0, Math.min(window.innerWidth - 70, drag.right + dx)),
          top: Math.max(0, Math.min(Math.max(0, maxTop), drag.top + dy)),
        }))
      }

      const onPointerUp = e => {
        setDragging(false)
        // 先处理双指捏合的收尾
        if (touchPointsRef.current.has(e.pointerId)) {
          touchPointsRef.current.delete(e.pointerId)
          if (pinchRef.current) {
            // 只剩一根手指时结束捏合并持久化；剩下那根不再当作拖动
            if (touchPointsRef.current.size < 2) {
              endPinch(true)
            }
            return
          }
        }
        const drag = dragRef.current
        if (!drag || drag.id !== e.pointerId) {
          // 锁定状态下没有拖动记录，但单击/双击仍然有效
          if (settings.locked && e.target === e.currentTarget) {
            if (longPressRef.current) {
              window.clearTimeout(longPressRef.current)
              longPressRef.current = null
            }
            const pointer = lockedPointerRef.current
            lockedPointerRef.current = null
            // 长按已经开过菜单，抬手不再重复触发点击
            if (!pointer || pointer.id !== e.pointerId || Date.now() - pointer.at >= LONG_PRESS_MS) return
            const now = Date.now()
            const last = lastTapRef.current || 0
            if (now - last < 320) {
              lastTapRef.current = 0
              setMenuOpen(true)
            } else {
              lastTapRef.current = now
              pet()
            }
          }
          return
        }
        dragRef.current = null
        if (longPressRef.current) {
          window.clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
        savePrefs({ ...prefs, hidden: false })
        // 短按且几乎没移动 → 摸摸；快速连点两下 → 打开菜单
        if (!movedRef.current && Date.now() - drag.at < LONG_PRESS_MS) {
          const now = Date.now()
          const last = lastTapRef.current || 0
          if (now - last < 320) {
            lastTapRef.current = 0
            setMenuOpen(true)
          } else {
            lastTapRef.current = now
            pet()
          }
        }
      }

      const onPointerCancel = e => {
        dragRef.current = null
        setDragging(false)
        if (e && touchPointsRef.current.has(e.pointerId)) {
          touchPointsRef.current.delete(e.pointerId)
        }
        if (pinchRef.current && touchPointsRef.current.size < 2) {
          endPinch(true)
        }
        if (resizeRef.current) {
          resizeRef.current = null
          setResizing(false)
        }
        if (longPressRef.current) {
          window.clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
      }

      // ==================== 左下角缩放把手 ====================

      /**
       * 按下把手：记录起始指针与起始尺寸。
       * 把手在卡片左下角，向左下拖 = 放大，向右上拖 = 缩小。
       */
      const onResizeDown = e => {
        if (settings.locked) return
        e.preventDefault()
        e.stopPropagation()
        setResizing(true)
        resizeRef.current = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startSize: settings.size,
        }
        e.currentTarget.setPointerCapture?.(e.pointerId)
        if (longPressRef.current) {
          window.clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
      }

      /**
       * 拖动把手：按指针位移调整高度。
       * 把手在卡片左下角，向左下拖（dx、dy 都为负）= 放大。
       * 横向与纵向各算一半，手感更接近对角拖动。
       */
      const onResizeMove = e => {
        const r = resizeRef.current
        if (!r || r.id !== e.pointerId) return
        e.stopPropagation()
        const dx = e.clientX - r.startX
        const dy = e.clientY - r.startY
        const deltaPx = -(dx + dy) * 0.5
        // 直接按像素累加，再整体夹到允许范围，不经过百分比取整以免抖动
        const min = Math.round(SIZE_BASE * SCALE_MIN_PERCENT / 100)
        const max = Math.round(SIZE_BASE * SCALE_MAX_PERCENT / 100)
        const nextSize = Math.min(max, Math.max(min, Math.round(r.startSize + deltaPx)))
        if (nextSize !== settings.size) {
          setSettings(prev => ({ ...prev, size: nextSize }))
        }
      }

      /** 松开把手：持久化最终尺寸，并采用宿主规范化后的结果。 */
      const onResizeUp = e => {
        if (!resizeRef.current) return
        e.stopPropagation()
        resizeRef.current = null
        setResizing(false)
        putSettings(settingsRef.current).then(saved => {
          setSettings(saved)
        }).catch(() => { /* 保存失败时保持当前尺寸，不打断用户 */ })
      }

      if (!globallyEnabled) {
        // 关掉后留一个半透明小圆点：随时能一键恢复，又不打扰
        return h('button', {
          key: 'fish-restore',
          type: 'button',
          title: t('kill.restore'),
          'aria-label': t('kill.restore'),
          onClick: turnOnFish,
          style: {
            position: 'fixed', right: 10, bottom: 88, zIndex: 2147482000,
            width: 34, height: 34, padding: 0, borderRadius: '50%',
            border: '1px solid rgba(47,163,122,.40)',
            background: 'rgba(255,255,255,.88)', cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,.12)',
            fontSize: 16, lineHeight: 1, opacity: 0.72,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          },
        }, '🐟')
      }

      const balance = state.balance
      const lowBalance = state.status === 'ready'
        && Number.parseFloat(balance?.total ?? '0') < 5
      const sad = state.status === 'error' || state.status === 'noKey' || lowBalance

      const label = state.status === 'loading'
        ? t('pet.loading')
        : state.status === 'noKey'
          ? t('pet.noKey')
          : state.status === 'error'
            ? t('pet.error')
            : formatAmount(balance)

      const phaseInfo = state.status === 'ready' && balance?.phase
        ? {
            isPeak: balance.phase === 'peak',
            text: balance.phaseLabel ?? (balance.phase === 'peak' ? t('phase.peak') : t('phase.idle')),
            tip: balance.phaseSummary ?? '',
          }
        : null

      const burn = state.status === 'ready' ? balance?.burnRate : null
      const burnInfo = burn && burn.trend === 'down' && Number.isFinite(burn.hoursLeft)
        ? {
            text: t('burn.left', { time: formatHours(burn.hoursLeft) }),
            tip: `平均 ${burn.perHour.toFixed(3)} ${balance.currency || ''}/小时，按此速度还能用 ${formatHours(burn.hoursLeft)}（基于 ${burn.sampleCount} 次采样）`,
          }
        : null

      // 天气投影：图标 + 温度 + 文字描述，三者都尽量展示，便于一眼看清
      const weatherInfo = weather && weather.ok
        ? {
            icon: weatherIcon(weather.kind),
            temp: weather.temperature !== null ? `${weather.temperature}°` : '',
            desc: weather.label || '',
            tip: `${weather.city ?? ''} ${weather.label}`
              + (weather.temperature !== null ? ` ${weather.temperature}°C` : '')
              + (weather.humidity !== null ? ` 湿度${weather.humidity}%` : '')
              + (weather.windSpeed !== null ? ` 风速${weather.windSpeed}km/h` : ''),
          }
        : null

      if (prefs.hidden && !menuOpen) {
        return h('div', {
          style: {
            position: 'fixed', right: 12, top: 64, zIndex: 60,
            borderRadius: 999, border: '1px solid rgba(0,0,0,.12)',
            background: `rgba(255,255,255,${Math.max(0.6, settings.opacity)})`, color: '#666',
            padding: '4px 8px', fontSize: 11, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,.12)',
          },
          title: t('pet.show'),
          onClick: () => { const next = { ...prefs, hidden: false }; setPrefs(next); savePrefs(next) },
        }, '🐟')
      }

      // 动画形象是「透明背景的整只宠物」：卡片本身透明、无边框，只留余额等小徽章
      const isAnim = settings.appearance === 'animation' && !animError

      const card = h('div', {
        ref: cardRef,
        role: 'button',
        tabIndex: 0,
        className: pinching ? 'fishpet-card fishpet-pinching' : 'fishpet-card',
        'aria-label': t('pet.aria'),
        title: t('pet.tip'),
        style: {
          position: 'fixed',
          right: prefs.right,
          top: prefs.top,
          zIndex: 60,
          padding: isAnim ? 0 : '6px 4px 5px',
          borderRadius: 16,
          background: isAnim ? 'transparent' : `rgba(255,255,255,${settings.opacity})`,
          boxShadow: isAnim
            ? 'none'
            : pinching
              ? '0 0 0 2px rgba(47,163,122,.45), 0 4px 16px rgba(0,0,0,.16)'
              : '0 4px 16px rgba(0,0,0,.16)',
          border: isAnim ? 'none' : '1px solid rgba(0,0,0,.08)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          cursor: 'grab',
          userSelect: 'none',
          // 禁止浏览器把双指手势当成页面缩放
          touchAction: 'none',
          backdropFilter: !isAnim && settings.opacity < 0.98 ? 'blur(6px)' : 'none',
        },
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onContextMenu: e => { e.preventDefault(); setMenuOpen(true) },
        onKeyDown: e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pet() }
        },
      }, [
        weatherInfo ? h('div', {
          key: 'wx',
          title: weatherInfo.tip,
          style: {
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 10, lineHeight: 1.25, whiteSpace: 'nowrap',
            padding: '0 4px', borderRadius: 6,
            background: 'rgba(120,150,200,.14)',
            color: '#3b4a66',
          },
        }, [
          h('span', { key: 'i', style: { fontSize: 11 } }, weatherInfo.icon),
          weatherInfo.temp ? h('span', { key: 't', style: { fontWeight: 600 } }, weatherInfo.temp) : null,
          weatherInfo.desc ? h('span', { key: 'd', style: { opacity: 0.8 } }, weatherInfo.desc) : null,
        ]) : null,
        h(PetVisual, {
          key: 'visual',
          settings,
          petted: !!petted,
          pettedTick,
          dragging,
          live2dFailed: !!live2dError,
          dynamicFailed: !!dynamicError,
          animFailed: !!animError,
          onLoadError: () => setImgError(true),
          onLive2DError: (code) => setLive2dError(code || 'LOAD_FAILED'),
          onDynamicError: (code) => setDynamicError(code || 'DYNAMIC_FAILED'),
          onAnimError: (code) => setAnimError(code || 'ANIM_FAILED'),
          t,
        }),
        imgError ? h('div', {
          key: 'err', style: { fontSize: 9, color: '#c66', whiteSpace: 'nowrap' },
        }, '图片加载失败') : null,
        live2dError ? h('div', {
          key: 'l2derr',
          title: live2dError === 'NO_WEBGL' ? t('menu.live2d.noWebgl') : t('menu.live2d.failed'),
          style: { fontSize: 9, color: '#c66', whiteSpace: 'nowrap' },
        }, live2dError === 'NO_WEBGL' ? '无 WebGL' : 'Live2D 失败') : null,
        dynamicError ? h('div', {
          key: 'dynerr',
          title: t('menu.dynamic.failed'),
          style: { fontSize: 9, color: '#c66', whiteSpace: 'nowrap' },
        }, '动态失败') : null,
        animError ? h('div', {
          key: 'animerr',
          title: t('menu.anim.missing'),
          style: {
            fontSize: 9, color: '#c66', whiteSpace: 'nowrap',
            padding: '1px 6px', borderRadius: 999, background: 'rgba(255,255,255,.8)',
          },
        }, '动画素材缺失') : null,
        h('div', {
          key: 'amount',
          style: {
            fontSize: 10.5, fontWeight: 600, lineHeight: 1.2,
            ...(isAnim
              ? {
                  marginTop: 2,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,.82)',
                  boxShadow: '0 1px 6px rgba(0,0,0,.10)',
                }
              : null),
            color: flash === 'down'
              ? '#e05a5a'
              : flash === 'up'
                ? '#2fa37a'
                : state.status === 'ready'
                  ? (lowBalance ? '#d9822b' : '#0a7')
                  : '#999',
            whiteSpace: 'nowrap',
            transform: flash ? 'scale(1.12)' : 'scale(1)',
            transition: 'color .3s ease, transform .3s ease',
          },
        }, label),
        voiceHint ? h('div', {
          key: 'vhint',
          style: {
            fontSize: 9, lineHeight: 1.3, maxWidth: 170,
            color: '#c0392b', textAlign: 'center', whiteSpace: 'normal',
          },
        }, voiceHint) : null,
        burnInfo ? h('div', {
          key: 'burn',
          title: burnInfo.tip,
          style: { fontSize: 9, lineHeight: 1.3, whiteSpace: 'nowrap', color: '#8a8f98' },
        }, burnInfo.text) : null,
        phaseInfo ? h('div', {
          key: 'phase',
          title: phaseInfo.tip,
          style: {
            fontSize: 9, lineHeight: 1.4, padding: '0 5px',
            borderRadius: 999, whiteSpace: 'nowrap',
            color: phaseInfo.isPeak ? '#b45309' : '#15803d',
            background: phaseInfo.isPeak ? 'rgba(245,158,11,.16)' : 'rgba(34,197,94,.16)',
            border: '1px solid ' + (phaseInfo.isPeak ? 'rgba(245,158,11,.35)' : 'rgba(34,197,94,.35)'),
          },
        }, phaseInfo.text) : null,
        // 锁定标识：仅作提示，点击可快速解锁
        settings.locked ? h('div', {
          key: 'lockmark',
          className: 'fishpet-hit',
          title: t('menu.locked.hint'),
          'aria-label': t('menu.locked'),
          onClick: e => {
            e.stopPropagation()
            const next = { ...settings, locked: false }
            setSettings(next)
            putSettings(next).then(setSettings).catch(() => {
              // 保存失败就还原，避免界面显示已解锁但实际仍锁定
              setSettings(prev => ({ ...prev, locked: true }))
            })
          },
          onPointerDown: e => e.stopPropagation(),
          style: {
            position: 'absolute', top: 2, left: 4,
            fontSize: 9, lineHeight: 1, cursor: 'pointer',
            color: '#9aa3ad', userSelect: 'none',
          },
        }, '🔒') : null,
        // 左下角缩放把手：拖动即可按比例放大缩小
        settings.locked ? null : h('div', {
          key: 'resize',
          className: 'fishpet-hit',
          role: 'slider',
          tabIndex: 0,
          'aria-label': t('menu.scale'),
          'aria-valuemin': SCALE_MIN_PERCENT,
          'aria-valuemax': SCALE_MAX_PERCENT,
          'aria-valuenow': sizeToPercent(settings.size),
          'aria-valuetext': `${sizeToPercent(settings.size)}%`,
          title: `${t('menu.scale')} ${sizeToPercent(settings.size)}%`,
          onPointerDown: onResizeDown,
          onPointerMove: onResizeMove,
          onPointerUp: onResizeUp,
          onPointerCancel: onResizeUp,
          onKeyDown: e => {
            const cur = sizeToPercent(settings.size)
            let next = cur
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - 5
            else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + 5
            else if (e.key === 'Home') next = SCALE_MIN_PERCENT
            else if (e.key === 'End') next = SCALE_MAX_PERCENT
            else return
            e.preventDefault()
            e.stopPropagation()
            const next2 = { ...settings, size: percentToSize(next) }
            setSettings(next2)
            putSettings(next2).then(setSettings).catch(() => {})
          },
          style: {
            position: 'absolute',
            left: 0,
            bottom: 0,
            // 命中区比图标大得多：手掌大小的触屏也能稳稳按住
            width: 22,
            height: 22,
            zIndex: 3,
            cursor: 'nesw-resize',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-start',
            padding: 0,
            borderRadius: '0 0 0 16px',
            // 抓握反馈：平时透明，按下滑走时高亮，让人知道这里可以拖
            background: resizing === true
              ? 'rgba(47,163,122,.26)'
              : 'transparent',
            transition: 'background .15s ease',
          },
        }, h('svg', {
          key: 'g', width: 10, height: 10, viewBox: '0 0 10 10',
          'aria-hidden': true, focusable: 'false',
          style: { opacity: 0.55, margin: '2px 0 3px 3px', pointerEvents: 'none' },
        }, [
          h('path', {
            key: 'a',
            d: 'M1 9 L9 1',
            stroke: '#7a8797', strokeWidth: 1.2, strokeLinecap: 'round', fill: 'none',
          }),
          h('path', {
            key: 'b',
            d: 'M1 5 L5 1',
            stroke: '#7a8797', strokeWidth: 1.2, strokeLinecap: 'round', fill: 'none',
          }),
        ])),
      ])

      return h(React.Fragment, null, [
        petted && anchor ? h(OverlayErrorBoundary, { key: 'bubble-eb', where: 'bubble' },
          h(PetBubble, { key: 'bubble', text: petted, anchor })) : null,
        card,
        h(HarvestBanner, {
          key: 'harvest-banner',
          t,
          status: harvestStatus,
          onAck: ackHarvest,
          onKill: killFish,
          onOpenMenu: () => setMenuOpen(true),
        }),
        menuOpen ? h(OverlayErrorBoundary, { key: 'menu-eb', where: 'menu' }, h(PetMenu, {
          key: 'menu',
          t,
          settings,
          onClose: () => setMenuOpen(false),
          onSettingsChange: next => setSettings(next),
          // 隐藏只能从菜单里做，避免桌宠身上误触
          onHide: () => {
            const next = { ...prefs, hidden: true }
            setPrefs(next)
            savePrefs(next)
            setMenuOpen(false)
          },
        }) ) : null,
      ])
    }

    /** 随机取一句撒娇语（自定义优先）。 */
    function DEFAULT_PHRASES_PICK(custom) {
      const pool = Array.isArray(custom) && custom.length > 0 ? custom : DEFAULT_PHRASES
      return pool[Math.floor(Math.random() * pool.length)]
    }

    // ==================== 设置页开关 ====================

    /** 设置 → 通用 里的开关行。 */
    function PetSettingRow({ t }) {
      const on = useEnabled()
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '10px 0', width: '100%',
        },
      }, [
        h('div', { key: 'label', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
          h('div', { key: 'title', style: { fontSize: 14, color: 'inherit' } }, t('setting.title')),
          h('div', {
            key: 'desc',
            style: { fontSize: 12, opacity: 0.65, lineHeight: 1.4 },
          }, t('setting.desc')),
        ]),
        h(Toggle, {
          key: 'toggle',
          on,
          label: t('setting.title'),
          onChange: v => { enabledState.set(v); void syncPower(v) },
        }),
      ])
    }

    // ==================== 导出 ====================

    return {
      inject: ['slots', 'locale'],
      /** 仅供离线 DOM 冒烟测试使用的内部函数，不参与运行时逻辑。 */
      __test: {
        PetMenu,
        DynamicPet,
        Live2DPet,
        PetVisual,
        AnimationPet,
        PetImage,
        animationStageWidth,
        pickOne,
        pickRandomCategory,
        playLive2DMotion,
        supportsWebGL,
        loadLive2DRuntime,
        fetchLive2DModels,
        SETTINGS_DEFAULTS,
      },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fish-pet: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          // shell.overlay 是 list 槽，必须用 id 标识（单例槽才用 key）
          id: 'fish-pet',
          order: 50,
          locale: NS,
        }, FishPet))
        // 设置页的启用开关（同样是 list 槽）
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'fish-pet-setting',
          order: 50,
          locale: NS,
        }, PetSettingRow))
      },
    }
  },
})
