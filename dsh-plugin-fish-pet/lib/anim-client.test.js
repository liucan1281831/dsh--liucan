/**
 * 客户端动画形象（client.js 里的 AnimationPet）离线测试。
 *
 * client.js 是发给浏览器的 UMD 风格 bundle，这里用最小 React/DOM 桩把它加载起来，
 * 直接验证「动画形象的分发与抽取逻辑」——不需要真的浏览器，也不需要 .webm 素材文件。
 * 目的：避免出现「代码能过 node --check，但一加载就 ReferenceError」的情况。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

/** 最小 React 桩：只满足模块顶层与纯函数组件的调用。 */
class FakeComponent {
  constructor(props) { this.props = props; this.state = {} }
  setState() {}
  render() { return null }
}

const React = {
  Component: FakeComponent,
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: initial => [initial, () => {}],
  useRef: initial => ({ current: initial }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: fn => fn,
  useMemo: fn => fn(),
  useReducer: (_fn, initial) => [initial, () => {}],
  createContext: () => ({ Provider: () => null, Consumer: () => null }),
}

/** 捕获 DSH 模块加载器注册的定义。 */
let captured = null
globalThis.window = {
  __ModuleLoader__: { load(def) { captured = def } },
  addEventListener() {},
  removeEventListener() {},
  localStorage: { getItem() { return null }, setItem() {} },
  innerWidth: 1280,
  innerHeight: 800,
}
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  createElement: () => ({ style: {} }),
  head: { appendChild() {} },
  body: { appendChild() {} },
  getElementById: () => null,
  querySelector: () => null,
}

await import('../client.js')
assert.ok(captured, 'client.js 没有调用 window.__ModuleLoader__.load')

const mod = captured.factory(name => {
  if (name === 'react') return React
  throw new Error(`意外的依赖：${name}`)
})

const {
  PetVisual, AnimationPet, PetImage, DynamicPet, Live2DPet,
  animationStageWidth, pickOne, pickRandomCategory, SETTINGS_DEFAULTS,
} = mod.__test

/** 只关心组件类型的最小 settings。 */
const baseSettings = { ...SETTINGS_DEFAULTS, size: 76 }

test('client.js 能完整加载并导出动画形象组件', () => {
  assert.equal(typeof AnimationPet, 'function')
  assert.equal(typeof pickOne, 'function')
  assert.equal(typeof pickRandomCategory, 'function')
})

test('默认设置包含动画形象的两个开关', () => {
  assert.equal(SETTINGS_DEFAULTS.animRandomEnabled, true)
  assert.equal(SETTINGS_DEFAULTS.animClickEnabled, true)
})

test('PetVisual 按 appearance 分发，动画失败时回退图片', () => {
  const noop = () => {}
  const common = {
    petted: false, pettedTick: 0, dragging: false,
    live2dFailed: false, dynamicFailed: false, animFailed: false,
    onLoadError: noop, onLive2DError: noop, onDynamicError: noop, onAnimError: noop,
    t: key => key,
  }
  const pick = (appearance, extra = {}) => PetVisual({
    ...common,
    settings: { ...baseSettings, appearance, live2dModel: 'l2d-abcdef123456' },
    ...extra,
  }).type

  assert.equal(pick('animation'), AnimationPet)
  assert.equal(pick('animation', { animFailed: true }), PetImage)
  assert.equal(pick('live2d'), Live2DPet)
  assert.equal(pick('dynamic'), DynamicPet)
  assert.equal(pick('image'), PetImage)
})

test('动画画布大小：可见人物高度约等于 size', () => {
  // 画布宽 = size × 2.37，人物高 = 270/640 × 画布宽 ≈ size
  assert.equal(animationStageWidth(76), Math.round(76 * 2.37))
  assert.equal(animationStageWidth(150), Math.round(150 * 2.37))
  const visibleH = Math.round(270 * animationStageWidth(120) / 640)
  assert.ok(Math.abs(visibleH - 120) <= 1, `可见高度 ${visibleH} 应约等于 120`)
  // 上下限
  assert.equal(animationStageWidth(10), 110)
  assert.equal(animationStageWidth(500), 640)
  // 非数字兜底成默认 size
  assert.equal(animationStageWidth(undefined), Math.round(76 * 2.37))
})

test('pickOne 空数组返回空串，否则一定命中池内元素', () => {
  assert.equal(pickOne([]), '')
  assert.equal(pickOne(null), '')
  assert.equal(pickOne(['只有这一个']), '只有这一个')
  const pool = ['a', 'b', 'c']
  for (let i = 0; i < 50; i += 1) assert.ok(pool.includes(pickOne(pool)))
})

test('pickRandomCategory 跳过空分类，权重为 0 时返回 null', () => {
  assert.equal(pickRandomCategory([]), null)
  assert.equal(pickRandomCategory(null), null)
  assert.equal(pickRandomCategory([{ weight: 0, actions: [] }, { weight: 5, actions: [] }]), null)
  const only = { weight: 3, actions: ['吃白饭'] }
  assert.equal(pickRandomCategory([{ weight: 0, actions: [] }, only]), only)
})

test('pickRandomCategory 按上游权重分布（20/20/16/14/10）', () => {
  const categories = [
    { id: '小动作', weight: 20, actions: ['a'] },
    { id: '玩耍', weight: 20, actions: ['b'] },
    { id: '吃什么', weight: 16, actions: ['c'] },
    { id: '时节', weight: 14, actions: ['d'] },
    { id: '文字', weight: 10, actions: ['e'] },
  ]
  const total = 80
  const counts = new Map(categories.map(c => [c.id, 0]))
  const ROLLS = 40000
  for (let i = 0; i < ROLLS; i += 1) {
    const picked = pickRandomCategory(categories)
    counts.set(picked.id, counts.get(picked.id) + 1)
  }
  for (const category of categories) {
    const expected = category.weight / total
    const observed = counts.get(category.id) / ROLLS
    assert.ok(
      Math.abs(observed - expected) < 0.03,
      `${category.id} 权重偏差过大：期望 ${expected.toFixed(3)} 实际 ${observed.toFixed(3)}`,
    )
  }
})
