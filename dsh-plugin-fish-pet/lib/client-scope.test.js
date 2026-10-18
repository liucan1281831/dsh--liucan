/**
 * 客户端代码的静态作用域检查。
 *
 * 起因：`voiceAudioRef` 曾声明在 VoicePanel，却在 FishPet 里使用。
 * 运行时抛 ReferenceError，又被 catch 吞掉，表现是「点击桌宠没声音、
 * 也没有任何报错」，非常难查。这里用静态检查把这类问题拦在测试阶段。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url))
const SRC = readFileSync(CLIENT, 'utf8')

/** 取出某个组件函数体的源码（按 4 空格缩进的 function 声明切分）。 */
function componentBody(name) {
  const start = SRC.indexOf(`    function ${name}(`)
  assert.ok(start >= 0, `找不到组件 ${name}`)
  // 下一个同级缩进的 function 或文件结尾
  const rest = SRC.slice(start + 1)
  const next = rest.search(/\n {4}function [A-Za-z_$][\w$]*\(/)
  return next < 0 ? rest : rest.slice(0, next)
}

/** 收集 body 中 `xxxRef.current` 用到的名字。 */
function refsUsed(body) {
  const used = new Set()
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*Ref)\.current/g)) used.add(m[1])
  return used
}

/** 收集 body 中 `const xxxRef = React.useRef` 声明的名字。 */
function refsDeclared(body) {
  const declared = new Set()
  for (const m of body.matchAll(/const ([A-Za-z_$][\w$]*Ref) = React\.useRef/g)) declared.add(m[1])
  return declared
}

test('每个组件用到的 ref 都必须在自身作用域声明', () => {
  for (const name of ['FishPet', 'VoicePanel']) {
    const body = componentBody(name)
    const used = refsUsed(body)
    const declared = refsDeclared(body)
    const missing = [...used].filter(r => !declared.has(r)).sort()
    assert.deepEqual(
      missing, [],
      `${name} 引用了未声明的 ref（运行时会 ReferenceError 且被静默吞掉）：${missing.join(', ')}`,
    )
  }
})

test('每个组件用到的 useState 设值函数都有对应声明', () => {
  for (const name of ['FishPet', 'VoicePanel']) {
    const body = componentBody(name)
    const declared = new Set()
    for (const m of body.matchAll(/const \[[^\]]*,\s*([A-Za-z_$][\w$]*)\]\s*=\s*React\.useState/g)) {
      declared.add(m[1])
    }
    const GLOBAL_SETTERS = new Set(['setTimeout', 'setInterval', 'setImmediate'])
    const used = new Set()
    // 只匹配独立的 setter 调用（排除 obj.setXxx(...) 这种成员方法）
    for (const m of body.matchAll(/(?<![.\w$])(set[A-Z][\w$]*)\s*\(/g)) used.add(m[1])
    const missing = [...used].filter(s => !declared.has(s) && !GLOBAL_SETTERS.has(s)).sort()
    assert.deepEqual(missing, [], `${name} 调用了未声明的 setter：${missing.join(', ')}`)
  }
})

test('所有返回给用户的错误提示都有兜底文案', () => {
  // 提示必须能落到界面上，不能只 console
  assert.ok(SRC.includes('setVoiceHint'), '语音失败必须给出可见提示')
  const hintCalls = [...SRC.matchAll(/setVoiceHint\(/g)].length
  assert.ok(hintCalls >= 3, `setVoiceHint 调用过少（${hintCalls}），可能又静默吞错误了`)
})

test('隐藏桌宠只能从菜单触发，桌宠身上不能有关闭按钮', () => {
  // 曾经桌宠右上角有个 11px 的 ×，双击/拖动时容易误触，表现就是「双击把桌宠关掉了」
  const hides = [...SRC.matchAll(/hidden: true/g)].length
  assert.equal(hides, 1, '隐藏逻辑只应存在一处（菜单回调）')
  assert.ok(SRC.includes('onHide'), '菜单需要通过 onHide 触发隐藏')
  assert.ok(SRC.includes("'menu.hidePet'"), '菜单里必须有隐藏入口')
  assert.ok(!SRC.includes("title: t('pet.hide')"), '桌宠身上不应再有隐藏按钮')
})

test('单击与双击不冲突：双击只开菜单', () => {
  // 双击分支只能 setMenuOpen(true)，不能做隐藏/关闭
  const dbl = [...SRC.matchAll(/if \(now - last < 320\) \{([\s\S]{0,200}?)\}/g)].map(m => m[1])
  assert.ok(dbl.length >= 2, '应有两处双击判定（锁定/普通）')
  for (const body of dbl) {
    assert.ok(body.includes('setMenuOpen(true)'), '双击应打开菜单')
    assert.ok(!body.includes('hidden'), '双击不应隐藏桌宠')
  }
})

test('语音面板不能引用菜单组件的变量（draft/patch/commit）', () => {
  // 真实故障：语音面板里误用了 PetMenu 的 draft/patch/commit，
  // 一打开菜单就 ReferenceError，整棵覆盖层被卸载 ——
  // 表现就是「双击后桌宠消失、菜单打不开」。
  const body = componentBody('VoicePanel')
  for (const bad of ['draft', 'patch(', 'commit(']) {
    const re = new RegExp(`(?<![.\\w$])${bad.replace('(', '\\(')}`)
    assert.ok(!re.test(body), `VoicePanel 不应引用 ${bad}`)
  }
})

test('语音面板里应使用 settings / onPatch / onCommit', () => {
  const body = componentBody('VoicePanel')
  assert.ok(body.includes('settings.'), '应读取 settings')
  assert.ok(body.includes('onPatch('), '应通过 onPatch 修改')
  assert.ok(body.includes('onCommit('), '应通过 onCommit 保存')
})
