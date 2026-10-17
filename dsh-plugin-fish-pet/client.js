window.__ModuleLoader__.load({
  id: 'dsh-plugin-fish-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'fish-pet'

    const zh = {
      'pet.aria': '余额小鱼桌宠',
      'pet.tip': '点击刷新余额，可拖动',
      'pet.loading': '查询中…',
      'pet.noKey': '未配置密钥',
      'pet.error': '查询失败',
      'pet.hide': '隐藏桌宠',
      'pet.show': '显示桌宠',
      'pet.balance': '余额',
      'pet.granted': '赠送',
      'pet.toppedUp': '充值',
      'pet.updated': '更新于',
      'pet.sad': '我不是大肥鱼…',
      'pet.sadLow': '余额快不够了…',
      'phase.peak': '高峰',
      'phase.idle': '空闲',
      'setting.title': '余额桌宠',
      'setting.desc': '在界面右上角显示小鱼桌宠，实时展示 DeepSeek 余额。',
    }

    const en = {
      'pet.aria': 'Balance pet',
      'pet.tip': 'Click to refresh, drag to move',
      'pet.loading': 'Loading…',
      'pet.noKey': 'No API key',
      'pet.error': 'Failed',
      'pet.hide': 'Hide pet',
      'pet.show': 'Show pet',
      'pet.balance': 'Balance',
      'pet.granted': 'Granted',
      'pet.toppedUp': 'Topped up',
      'pet.updated': 'Updated',
      'pet.sad': "I'm not a big fat fish…",
      'pet.sadLow': 'Running low…',
      'phase.peak': 'Peak',
      'phase.idle': 'Idle',
      'setting.title': 'Balance pet',
      'setting.desc': 'Show a fish pet in the top-right corner with your DeepSeek balance.',
    }

    /** 宿主端暴露的余额端点（与 index.js 的 BALANCE_PATH 一致）。 */
    const BALANCE_PATH = '/api/fish-pet/balance'
    /** 桌宠原图（由宿主端点提供，与 index.js 的 PET_IMG_PATH 一致）。 */
    const PET_IMG = '/api/fish-pet/image'
    /** 位置与显隐的持久化键。 */
    const STORAGE_KEY = 'dsh.fishpet.v2'
    /** 默认贴右上角（避开顶部标题栏与右侧面板）。 */
    const DEFAULT_POS = { right: 16, top: 64 }
    /** 兜底轮询间隔（毫秒）。 */
    const POLL_MS = 60000
    /** 浮动动画的样式表 id，保证只注入一次。 */
    const STYLE_ID = 'dsh-fishpet-keyframes'

    /**
     * 极简共享状态：桌宠与设置页开关之间的桥。
     *
     * DSH 的 slot 组件彼此独立，没有现成的跨组件 store 注入，
     * 这里用一个模块级订阅表即可满足「一个开关控制一个悬浮层」的需求。
     */
    const enabledState = {
      listeners: new Set(),
      value: true,
      get() {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY)
          if (raw) return JSON.parse(raw).disabled !== true
        } catch { /* ignore */ }
        return true
      },
      set(next) {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY)
          const prefs = raw ? JSON.parse(raw) : { ...DEFAULT_POS, hidden: false }
          prefs.disabled = next !== true
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
        } catch { /* ignore */ }
        enabledState.value = next
        for (const fn of enabledState.listeners) {
          try { fn(next) } catch { /* ignore */ }
        }
      },
      subscribe(fn) {
        enabledState.listeners.add(fn)
        return () => enabledState.listeners.delete(fn)
      },
    }

    /** 订阅开关状态。 */
    function useEnabled() {
      const [on, setOn] = React.useState(() => enabledState.get())
      React.useEffect(() => {
        setOn(enabledState.get())
        return enabledState.subscribe(setOn)
      }, [])
      return on
    }

    /** 注入一次关键帧动画，失败静默（SSR 或严格 CSP 环境）。 */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      try {
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = [
          '@keyframes fishpet-bob {',
          '  0%,100% { transform: translateY(0) }',
          '  50% { transform: translateY(-3px) }',
          '}',
        ].join('\n')
        document.head.appendChild(style)
      } catch {
        /* ignore */
      }
    }

    /** 读取持久化状态。 */
    function loadPrefs() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return { ...DEFAULT_POS, hidden: false }
        const parsed = JSON.parse(raw)
        return {
          right: Number.isFinite(parsed.right) ? parsed.right : DEFAULT_POS.right,
          top: Number.isFinite(parsed.top) ? parsed.top : DEFAULT_POS.top,
          hidden: parsed.hidden === true,
        }
      } catch {
        return { ...DEFAULT_POS, hidden: false }
      }
    }

    /** 写入持久化状态，失败静默（隐私模式等）。 */
    function savePrefs(prefs) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
      } catch {
        /* ignore */
      }
    }

    /** 把余额投影格式化成一行文本。 */
    function formatAmount(balance) {
      if (!balance) return '--'
      const value = Number.parseFloat(balance.total)
      if (!Number.isFinite(value)) return balance.total ?? '--'
      return `${value.toFixed(2)} ${balance.currency || ''}`.trim()
    }

    /**
     * 蓝色女仆肥鱼形象——直接使用用户提供的原图。
     *
     * 图片由插件自身提供：/plugins/dsh-plugin-fish-pet/pet.png（透明背景 PNG）。
     * 不再用 SVG 手绘近似，完全沿用原图。
     *
     * @param {{ size: number, bob: boolean }} props
     */
    function FishMaid({ size, sad }) {
      const s = size ?? 76
      return h('img', {
        src: PET_IMG,
        alt: '',
        draggable: 'false',
        'aria-hidden': 'true',
        style: {
          display: 'block',
          width: 'auto',
          height: s,
          // 委屈时略缩小并下沉，做出「缩起来」的感觉
          transform: sad ? 'scale(0.97) translateY(1px)' : 'none',
          transition: 'transform .3s ease',
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.18))',
          pointerEvents: 'none',
          userSelect: 'none',
        },
      })
    }

    /** 桌宠主组件（挂在 shell.overlay 槽）。 */
    function FishPet({ t }) {
      const [prefs, setPrefs] = React.useState(loadPrefs)
      const globallyEnabled = useEnabled()
      const [state, setState] = React.useState({ status: 'idle', balance: null, error: null })
      const dragRef = React.useRef(null)

      // 挂载时注入关键帧
      React.useEffect(() => { ensureStyles() }, [])

      const refresh = React.useCallback(async () => {
        if (typeof fetch !== 'function') {
          setState({ status: 'error', balance: null, error: 'fetch-unavailable' })
          return
        }
        setState(prev => ({ ...prev, status: 'loading' }))
        try {
          // 相对路径：沿用页面自身的鉴权 cookie，不跨域、不外泄
          const response = await fetch(BALANCE_PATH, {
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

      // 首轮加载 + 定时轮询；页面隐藏时暂停，省电
      React.useEffect(() => {
        refresh()
        let timer = null
        const tick = () => {
          if (document.visibilityState === 'visible') refresh()
        }
        timer = window.setInterval(tick, POLL_MS)
        const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [refresh])

      // 拖动：pointer 事件 + 限制在视口内（使用 top 定位，贴右上角）
      const onPointerDown = e => {
        if (e.button !== undefined && e.button !== 0) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        dragRef.current = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          right: prefs.right,
          top: prefs.top,
        }
      }

      const onPointerMove = e => {
        const drag = dragRef.current
        if (!drag || drag.id !== e.pointerId) return
        const dw = drag.startX - e.clientX
        const dh = e.clientY - drag.startY
        const next = {
          ...prefs,
          right: Math.max(4, Math.min(window.innerWidth - 70, drag.right + dw)),
          top: Math.max(4, Math.min(window.innerHeight - 90, drag.top + dh)),
        }
        setPrefs(next)
      }

      const onPointerUp = e => {
        const drag = dragRef.current
        if (!drag || drag.id !== e.pointerId) return
        dragRef.current = null
        savePrefs(prefs)
        // 几乎没有位移时视为点击 → 刷新
        const moved = Math.abs(drag.startX - e.clientX) + Math.abs(e.clientY - drag.startY)
        if (moved < 5) refresh()
      }

      // 总开关关闭时整个悬浮层不渲染（设置页可重新打开）
      if (!globallyEnabled) return null

      const hidden = prefs.hidden
      // 余额正常时鱼尾是清新的青蓝；出错或未配置时偏粉，显得委屈
      const tone = state.status === 'error' || state.status === 'noKey'
        ? '#e8a2b0'
        : state.status === 'loading'
          ? '#9fc4ec'
          : '#6fd0d8'
      // 委屈表情：出错、未配置，或余额低
      const lowBalance = state.status === 'ready'
        && Number.parseFloat(state.balance?.total ?? '0') < 5
      const sad = state.status === 'error' || state.status === 'noKey' || lowBalance

      const label = state.status === 'loading'
        ? t('pet.loading')
        : state.status === 'noKey'
          ? t('pet.noKey')
          : state.status === 'error'
            ? t('pet.error')
            : formatAmount(state.balance)

      // 气泡台词：呼应参考图「我不是大肥鱼」，随状态变化
      const bubble = sad
        ? t(lowBalance ? 'pet.sadLow' : 'pet.sad')
        : null

      // 峰谷时段徽标：与余额工具的信息保持一致
      const phaseInfo = state.status === 'ready' && state.balance?.phase
        ? {
            isPeak: state.balance.phase === 'peak',
            text: state.balance.phaseLabel
              ?? (state.balance.phase === 'peak' ? t('phase.peak') : t('phase.idle')),
            tip: state.balance.phaseSummary ?? '',
          }
        : null

      // 隐藏时留一个小把手，避免用户找不到桌宠（贴右上角，与桌宠同侧）
      if (hidden) {
        return h('div', {
          style: {
            position: 'fixed', right: 12, top: 64, zIndex: 60,
            borderRadius: 999, border: '1px solid rgba(0,0,0,.12)',
            background: 'rgba(255,255,255,.9)', color: '#666',
            padding: '4px 8px', fontSize: 11, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,.12)',
          },
          title: t('pet.show'),
          onClick: () => { const next = { ...prefs, hidden: false }; setPrefs(next); savePrefs(next) },
        }, '🐟')
      }

      return h('div', {
        role: 'button',
        tabIndex: 0,
        'aria-label': t('pet.aria'),
        title: t('pet.tip'),
        style: {
          position: 'fixed',
          right: prefs.right,
          top: prefs.top,
          zIndex: 60,
          width: 78,
          padding: '6px 4px 5px',
          borderRadius: 16,
          background: 'rgba(255,255,255,.92)',
          boxShadow: '0 4px 16px rgba(0,0,0,.16)',
          border: '1px solid rgba(0,0,0,.08)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
          transition: 'transform .15s ease',
          backdropFilter: 'blur(6px)',
        },
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onKeyDown: e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refresh() }
        },
        // 悬停轻微放大，增加「活物」感
        onPointerEnter: e => { e.currentTarget.style.transform = 'scale(1.06)' },
        onPointerLeave: e => { e.currentTarget.style.transform = 'scale(1)' },
      }, [
        // 对话气泡（委屈时出现，参考图风格）
        bubble ? h('div', {
          key: 'bubble',
          style: {
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 6,
            padding: '4px 8px',
            borderRadius: 12,
            background: '#fff',
            border: '1.5px solid #2b3a67',
            color: '#2b3a67',
            fontSize: 10,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0,0,0,.12)',
          },
        }, bubble) : null,
        h('div', {
          key: 'fish',
          style: {
            // 轻微上下浮动，让它看起来有生命
            animation: 'fishpet-bob 3s ease-in-out infinite',
            transformOrigin: '50% 90%',
          },
        }, h(FishMaid, { tone, sad })),
        h('div', {
          key: 'amount',
          style: {
            fontSize: 10.5, fontWeight: 600, lineHeight: 1.2,
            color: state.status === 'ready'
              ? (lowBalance ? '#d9822b' : '#0a7')
              : '#999',
            whiteSpace: 'nowrap',
          },
        }, label),
        // 峰谷时段徽标：高峰橙色、空闲绿色，hover 显示完整说明
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
        // 隐藏按钮
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
            color: '#bbb', fontSize: 11, cursor: 'pointer', padding: 0,
            lineHeight: 1,
          },
        }, '×'),
      ])
    }

    /**
     * 设置页里的开关行：控制桌宠是否显示。
     *
     * 这是用户要求的「在 DSH 内启用/停用桌宠」的入口，
     * 与悬浮层的共享状态联动，改完立即生效。
     */
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
        h('button', {
          key: 'toggle',
          type: 'button',
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          'aria-label': t('setting.title'),
          onClick: () => enabledState.set(!on),
          style: {
            flex: '0 0 auto',
            width: 46, height: 26, borderRadius: 999,
            border: '1px solid ' + (on ? '#2fa37a' : 'rgba(0,0,0,.18)'),
            background: on ? '#34b98b' : 'rgba(0,0,0,.12)',
            cursor: 'pointer', position: 'relative',
            transition: 'background .18s ease, border-color .18s ease',
            padding: 0,
          },
        }, h('span', {
          style: {
            position: 'absolute', top: 2, left: on ? 22 : 2,
            width: 20, height: 20, borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,.25)',
            transition: 'left .18s ease',
          },
        })),
      ])
    }

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
        // 设置页的启用开关（DSH 内置入口，属于 list 槽）
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

