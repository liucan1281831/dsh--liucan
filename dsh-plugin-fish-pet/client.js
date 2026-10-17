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
      phrases: [],
      soundEnabled: false,
      soundVolume: 0.5,
      soundUrl: '',
      weatherEnabled: true,
      weatherCity: '北京',
      shortcut: 'ctrl+shift+p',
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
      'pet.tip': '点击摸摸 · 长按菜单 · 拖动移动',
      'pet.loading': '查询中…',
      'pet.noKey': '未配置密钥',
      'pet.error': '查询失败',
      'pet.hide': '隐藏桌宠',
      'pet.show': '显示桌宠',
      'phase.peak': '高峰',
      'phase.idle': '空闲',
      'burn.left': '约剩 {time}',
      'menu.title': '桌宠菜单',
      'menu.close': '关闭菜单',
      'menu.appearance': '外观',
      'menu.size': '大小',
      'menu.opacity': '背景透明度',
      'menu.image': '更换形象',
      'menu.image.builtin': '使用内置形象',
      'menu.image.upload': '上传图片 / GIF',
      'menu.image.hint': '支持 PNG / JPG / GIF / WebP，≤8MB',
      'menu.sound': '点击音效',
      'menu.sound.enable': '启用音效',
      'menu.sound.upload': '上传音效',
      'menu.sound.hint': '支持 MP3 / WAV / OGG，≤2MB',
      'menu.sound.volume': '音量',
      'menu.phrases': '摸摸短语',
      'menu.phrases.hint': '每行一句，留空则用内置撒娇语',
      'menu.phrases.placeholder': '大肥鱼才不是吃白饭的！(｀・ω・´)',
      'menu.weather': '天气',
      'menu.weather.enable': '显示天气',
      'menu.weather.city': '城市',
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
      'pet.tip': 'Tap to pet · Long-press for menu · Drag to move',
      'pet.loading': 'Loading…',
      'pet.noKey': 'No API key',
      'pet.error': 'Failed',
      'pet.hide': 'Hide pet',
      'pet.show': 'Show pet',
      'phase.peak': 'Peak',
      'phase.idle': 'Idle',
      'burn.left': '~{time} left',
      'menu.title': 'Pet Menu',
      'menu.close': 'Close menu',
      'menu.appearance': 'Appearance',
      'menu.size': 'Size',
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
      'menu.phrases': 'Pet phrases',
      'menu.phrases.hint': 'One per line; empty uses built-in phrases',
      'menu.phrases.placeholder': "I'm not a big fat fish!",
      'menu.weather': 'Weather',
      'menu.weather.enable': 'Show weather',
      'menu.weather.city': 'City',
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

    // ==================== 菜单 ====================

    /** 长按打开的桌宠菜单。 */
    function PetMenu({ t, settings, onClose, onSettingsChange }) {
      const [draft, setDraft] = React.useState(settings)
      const [status, setStatus] = React.useState(null)
      const [uploading, setUploading] = React.useState('')
      const imageInputRef = React.useRef(null)
      const soundInputRef = React.useRef(null)

      React.useEffect(() => { setDraft(settings) }, [settings])

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
            ? { ...draft, useCustomImage: true, customImageUrl: j.url }
            : { ...draft, soundEnabled: true, soundUrl: j.url }
          setDraft(next)
          await commit(next)
        } catch (error) {
          setStatus(`${t('menu.upload.fail')}: ${error?.message ?? error}`)
        } finally {
          setUploading('')
        }
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
              const next = { ...draft, useCustomImage: false }
              setDraft(next); commit(next)
            },
          }, draft.useCustomImage ? t('menu.switch') : t('menu.current'))),
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

        // ---- 音效 ----
        h(Section, { key: 's3', title: t('menu.sound') }),
        h(Row, { key: 'son', label: t('menu.sound.enable') },
          h(Toggle, {
            on: draft.soundEnabled,
            label: t('menu.sound.enable'),
            onChange: v => { patch('soundEnabled', v); commit({ ...draft, soundEnabled: v }) },
          })),
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
      const [flash, setFlash] = React.useState(null)
      const [imgError, setImgError] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const cardRef = React.useRef(null)
      const lastTapRef = React.useRef(0)

      const dragRef = React.useRef(null)
      const longPressRef = React.useRef(null)
      const movedRef = React.useRef(false)
      const prevTotalRef = React.useRef(null)
      const audioRef = React.useRef(null)

      React.useEffect(() => { ensureStyles() }, [])

      // 桌宠位置变化时更新锚点，供气泡夹取用
      React.useLayoutEffect(() => {
        const el = cardRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        setAnchor({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
      }, [prefs.right, prefs.top, settings.size, petted, menuOpen])

      React.useEffect(() => {
        let alive = true
        fetchSettings().then(s => { if (alive) setSettings(s) })
        return () => { alive = false }
      }, [])

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

      const playSound = React.useCallback(() => {
        if (!settings.soundEnabled || !settings.soundUrl) return
        try {
          if (!audioRef.current || String(audioRef.current.src).indexOf(settings.soundUrl) < 0) {
            audioRef.current = new window.Audio(settings.soundUrl)
          }
          audioRef.current.volume = Math.min(1, Math.max(0, settings.soundVolume))
          audioRef.current.currentTime = 0
          const p = audioRef.current.play()
          if (p && typeof p.catch === 'function') p.catch(() => {})
        } catch { /* 浏览器可能禁止自动播放 */ }
      }, [settings.soundEnabled, settings.soundUrl, settings.soundVolume])

      const pet = React.useCallback(() => {
        setPetted(DEFAULT_PHRASES_PICK(settings.phrases))
        playSound()
        window.setTimeout(() => setPetted(null), 2600)
      }, [settings.phrases, playSound])

      const onPointerDown = e => {
        if (e.button !== undefined && e.button !== 0) return
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
        const drag = dragRef.current
        if (!drag || drag.id !== e.pointerId) return
        const dx = drag.startX - e.clientX
        const dy = e.clientY - drag.startY
        if (Math.abs(dx) + Math.abs(dy) > MOVE_TOLERANCE) {
          movedRef.current = true
          if (longPressRef.current) {
            window.clearTimeout(longPressRef.current)
            longPressRef.current = null
          }
        }
        setPrefs(prev => ({
          ...prev,
          right: Math.max(4, Math.min(window.innerWidth - 70, drag.right + dx)),
          top: Math.max(4, Math.min(window.innerHeight - 90, drag.top + dy)),
        }))
      }

      const onPointerUp = e => {
        const drag = dragRef.current
        if (!drag || drag.id !== e.pointerId) return
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

      const onPointerCancel = () => {
        dragRef.current = null
        if (longPressRef.current) {
          window.clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
      }

      if (!globallyEnabled) return null

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

      const card = h('div', {
        ref: cardRef,
        role: 'button',
        tabIndex: 0,
        'aria-label': t('pet.aria'),
        title: t('pet.tip'),
        style: {
          position: 'fixed',
          right: prefs.right,
          top: prefs.top,
          zIndex: 60,
          padding: '6px 4px 5px',
          borderRadius: 16,
          background: `rgba(255,255,255,${settings.opacity})`,
          boxShadow: '0 4px 16px rgba(0,0,0,.16)',
          border: '1px solid rgba(0,0,0,.08)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
          backdropFilter: settings.opacity < 0.98 ? 'blur(6px)' : 'none',
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
        h(PetImage, {
          key: 'img',
          settings,
          petted: !!petted,
          onLoadError: () => setImgError(true),
        }),
        imgError ? h('div', {
          key: 'err', style: { fontSize: 9, color: '#c66', whiteSpace: 'nowrap' },
        }, '图片加载失败') : null,
        h('div', {
          key: 'amount',
          style: {
            fontSize: 10.5, fontWeight: 600, lineHeight: 1.2,
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
        h('button', {
          key: 'hide',
          title: t('pet.hide'),
          onClick: e => {
            e.stopPropagation()
            const next = { ...prefs, hidden: true }
            setPrefs(next); savePrefs(next)
          },
          onPointerDown: e => e.stopPropagation(),
          style: {
            position: 'absolute', top: 2, right: 4,
            border: 'none', background: 'transparent',
            color: '#bbb', fontSize: 11, cursor: 'pointer', padding: 0, lineHeight: 1,
          },
        }, '×'),
      ])

      return h(React.Fragment, null, [
        petted && anchor ? h(PetBubble, { key: 'bubble', text: petted, anchor }) : null,
        card,
        menuOpen ? h(PetMenu, {
          key: 'menu',
          t,
          settings,
          onClose: () => setMenuOpen(false),
          onSettingsChange: next => setSettings(next),
        }) : null,
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
          onChange: v => enabledState.set(v),
        }),
      ])
    }

    // ==================== 导出 ====================

    return {
      inject: ['slots', 'locale'],
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
