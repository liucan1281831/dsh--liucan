# DeepSeek Balance Suite for DSH

> 本人写的 DSH 插件，欢迎大佬们多多指正。

为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 写的两个插件：

| 插件 | 作用 |
|---|---|
| **dsh-plugin-deepseek-balance** | 提供一个 Agent 工具 `deepseek_balance`，查询 DeepSeek 账户余额，并附带**峰谷计价时段**判定 |
| **dsh-plugin-fish-pet** | 界面右上角的**可换装桌宠**：余额、时段、天气、摸摸互动、音效，长按唤出完整菜单 |

两个插件共享同一套余额查询与时段逻辑，**信息永远一致**。

> 📌 **v0.2.0 更新**：桌宠新增长按菜单、实时天气、摸摸互动与自定义短语、大小/透明度调节、图片（含 GIF）更换、点击音效、快捷键。详见 [CHANGELOG](./CHANGELOG.md)。


---

## 功能

### 余额工具 `deepseek_balance`

Agent 可以直接调用，返回结构化数据：

```
余额充足：53.69 CNY（赠送 3.69，充值 50.00）
今日已用：1.24 CNY

时段：空闲时段（半价），距高峰时段还有 31小时36分
```

返回字段：

| 字段 | 说明 |
|---|---|
| `ok` | 查询是否成功 |
| `summary` | 一行人类可读摘要（含时段与今日已用） |
| `isAvailable` | 余额是否足以继续调用 |
| `balances[]` | 按币种的总余额 / 赠送余额 / 充值余额 |
| `phase` | `peak` 或 `idle` |
| `phaseReason` | `weekend` / `holiday` / `peak-window` / `off-window` / `makeup-workday` |
| `calendarCovered` | 该年份的节假日日历是否已收录 |
| `todayUsed` | 今日已用金额（当天首笔时为 `0`，见下） |
| `todayBaseline` | 今日基准余额 |
| `checkedAt` | 查询时间（ISO 8601） |

#### 今日用量统计 🆕

插件会把每次查询的余额存成本地快照（默认 `~/.dsh/deepseek-balance/usage.json`），用来算「今天花了多少」。

- **以当天第一笔为基准**，之后的查询与基准做差即为当日消耗
- 充值导致余额上升时，明确标记为"无法计算"而不是报负数
- 只保留最近 30 天，避免文件无限增长
- 快照文件权限 `0600`，只存余额数值，不含任何凭证

> ⚠️ **当天第一笔查询会显示「本次为今日首个基准」而不是 `0.00`** ——因为只有一个数据点，无法算出消耗。若显示 `0.00` 会让人误以为今天没花钱。

#### 节假日与调休 🆕

`peak.js` 内置了 2026 年法定节假日与**调休上班日**：

```js
HOLIDAYS           // 放假日期（整天空闲计费）
WORKDAY_OVERRIDES  // 调休上班的周六/周日（按工作日走高峰钟点）
COVERED_YEARS      // 已收录完整日历的年份
```

例如 2026-02-14（周六）是春节调休上班日，会按工作日计算高峰时段。

### 桌宠 🆕

悬浮在界面右上角的小鱼，可以换装、可以互动、可以调外观。

**基础**

- 悬浮右上角，**可拖动**，位置记忆
- 显示余额数字 + **峰谷时段徽标**（空闲绿 / 高峰橙）
- 自动轮询（60s，页面隐藏时暂停），点击即刷新
- 右上角 `×` 收起为一个小把手（🐟）
- **设置 → 通用** 里有「余额桌宠」总开关

**交互方式**

| 操作 | 效果 |
|---|---|
| **单击** | 摸摸：弹跳动画 + 随机撒娇语 + 可选音效 |
| **长按 500ms** | 打开完整设置菜单 |
| **双击** | 打开完整设置菜单（手机上更顺手） |
| **Ctrl+Shift+P** | 打开/关闭菜单（可自定义） |
| **拖动** | 移动位置 |

**摸摸互动 🆕**

点击桌宠会弹出气泡说一句撒娇语，内置 8 句（如「大肥鱼才不是吃白饭的！(｀・ω・´)」），**可在菜单里自定义**，每行一句。

气泡做了**视口夹取**：无论桌宠被拖到哪个角落，文字都会自动翻转方向（上→下）并夹进屏幕内，不会溢出看不见。

**实时天气 🆕**

- 数据来自 [Open-Meteo](https://open-meteo.com/)，**完全免费、无需 API Key**
- 显示图标 + 温度 + 文字描述（如「🌙 13.2° 晴间多云」），图标按昼夜切换
- 城市可配置；内置 49 个常见城市的坐标，**离线也能出天气**
- 后端缓存 10 分钟，避免频繁请求
- 可在菜单里关闭

**外观自定义 🆕**

菜单（长按/双击桌宠打开）里可调：

| 项目 | 范围 |
|---|---|
| 大小 | 40–200 px |
| 背景透明度 | 0–100% |
| 形象 | 内置图 或 上传自己的图 |
| 点击音效 | 开关 + 音量 0–100% |
| 摸摸短语 | 自定义，每行一句 |
| 天气 | 开关 + 城市 |
| 快捷键 | 如 `ctrl+shift+p` |

**更换形象 🆕**

支持上传 **PNG / JPG / GIF / WebP**（≤8MB）：

- **GIF 会自动播放**，可以放会动的桌宠
- 上传即生效，配置持久化在插件目录的 `.data/`
- 服务端按**文件头魔数**校验真实类型，改后缀伪装的文件会被拒绝
- 「恢复默认」可一键回到内置形象

**点击音效 🆕**

支持上传 **MP3 / WAV / OGG**（≤2MB），点击桌宠时播放，音量可调。同样按魔数校验。

> 浏览器可能限制自动播放，首次点击后才会解锁音频，这是浏览器策略而非插件问题。

### 语音与声音克隆 🆕

桌宠可以用你喜欢的音色说话：点击摸鱼时念一句撒娇语，打开页面时打招呼。

#### 能做什么

- **多种声源**：百度免费接口、Azure 神经语音、火山引擎豆包、OpenAI 兼容服务、任意自定义 URL 模板
- **手机自带语音**：直接调系统 TTS 引擎，零网络、零成本
- **本地声音克隆**：上传一段 3–20 秒的你说话的音视频，自动提取音频、自动识别文字，之后桌宠就用你的音色朗读任意文本
- **语种切换**：跟随声源 / 中文 / English / 日本語 / 한국어
- **点击音频策略**：自动（语音优先）/ 只用语音 / 只用音效 / 两个都播，默认不会叠音

#### 本地克隆怎么工作

全部在本机完成，不联网、不需要账号：

```
你上传音视频
  → ffmpeg 抽出音频（自动去画面轨、转 24kHz 单声道）
  → SenseVoice 识别参考文本
  → ZipVoice 用该音色合成任意文本
```

需要先装好依赖和模型（约 160MB）：

```bash
pip install sherpa-onnx numpy imageio-ffmpeg
```

模型放到 `~/.dsh/fish-pet/models/`（或用插件配置 `cloneModelDir` 指定）：

```
~/.dsh/fish-pet/models/
├── sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/   # 克隆 TTS
├── vocos_24khz.onnx                                  # 声码器
└── sherpa-onnx-sense-voice-*-int8-*/                 # 可选：自动识别参考文本
```

模型来自开源项目 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)，请按其授权使用。

#### 播放前先确认音频完整

为避免「话说一半没声了」，插件会等音频 `canplaythrough`、校验时长后才开始播（最多等 12 秒，超时也会播），并在播完后检查是否播到结尾。

### 消耗速率估算

桌宠会记住最近若干次余额采样，估算**按当前速度还能用多久**，显示在余额下方（例如「约剩 2天1小时」，悬停可看平均消耗与采样数）。

设计上刻意保守：

- **只在余额确实下降过时才给结论。** 余额上涨（充值）、持平，或采样不足（少于 2 次、时间跨度 < 1 分钟）时**不显示**，绝不编造一个数字。
- 采样只在内存里滚动（默认保留最近 60 个），**不落盘、不上传**。
- 重启 DSH 后重新积累。


### 余额变化动画 🆕

刷新后若余额发生变化，数字会短暂变色并轻微放大：

- **减少** → 红色一闪（让「钱在减少」看得见）
- **增加** → 绿色一闪

变化幅度小于 0.005 元不触发，避免浮点噪音。

### 峰谷时段规则

按 DeepSeek 官方定价：

| 时段 | 时间（北京时间） | 价格 |
|---|---|---|
| 高峰 | 周一至周五 09:00–12:00、14:00–18:00 | 标准价 |
| 空闲 | 其余全部时间（含周末与节假日） | **半价** |

> ✅ **已内置 2026 年完整日历**：法定节假日 + 调休上班日（来源：国办发明电〔2025〕7号）。
> 未收录的年份会退回「按工作日/周末估算」，并在结果里以 `calendarCovered: false` 明确标注，不假装有数据。
> 要补充其他年份，见下方「自定义节假日」。

---

## 安装

### 前置条件

- 已安装 DSH（`dsh` 命令可用）
- Node.js ≥ 20（插件使用原生 `fetch`）
- 一个 DeepSeek API Key

### 1. 放置插件

把两个目录放到你希望的位置，例如：

```sh
git clone https://github.com/<your-name>/<repo>.git ~/dsh-plugins
```

### 2. 链接到 DSH profile

DSH 的 profile 目录通常是 `~/.dsh/profiles/web`（移动端为 `/root/.dsh/profiles/web`）。

```sh
PLUGINS=~/dsh-plugins            # 换成你的实际路径
PROFILE=~/.dsh/profiles/web      # 换成你的实际 profile

mkdir -p "$PROFILE/node_modules"
ln -sfn "$PLUGINS/dsh-plugin-deepseek-balance" "$PROFILE/node_modules/dsh-plugin-deepseek-balance"
ln -sfn "$PLUGINS/dsh-plugin-fish-pet"         "$PROFILE/node_modules/dsh-plugin-fish-pet"
```

### 3. 登记为 bundle

编辑 `$PROFILE/package.json`，在两个数组里各加一项：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...原有内容...",
        "dsh-plugin-deepseek-balance",
        "dsh-plugin-fish-pet"
      ]
    }
  },
  "dependencies": {
    "...原有内容...": "...",
    "dsh-plugin-deepseek-balance": "link:/你的路径/dsh-plugin-deepseek-balance",
    "dsh-plugin-fish-pet": "link:/你的路径/dsh-plugin-fish-pet"
  }
}
```

> **为什么必须登记成 bundle？**
> 只挂在 `cordis.patch.yml` 里，插件能运行，但**不会出现在 DSH 的插件管理页**。
> 插件清单读取的是 profile `package.json` 的 `bundles` / `dependencies`。

### 4. 提供 API Key

插件**只从环境变量读取**密钥，支持两个变量名（前者优先）：

- `DEEPSEEK_API_KEY`
- `DSH_DEEPSEEK_API_KEY`

任选一种方式注入：

**方式 A：直接在启动环境里**

```sh
export DEEPSEEK_API_KEY=sk-你的密钥
dsh web
```

**方式 B：包装启动脚本**（推荐，密钥不进入 shell 历史）

创建一个权限 600 的文件：

```sh
umask 077
printf 'DEEPSEEK_API_KEY=%s\n' "$(read -rsp '密钥: ' k && echo "$k")" > ~/.dsh-secrets.env
```

然后在 `dsh` 的包装脚本里加载它：

```sh
#!/bin/sh
SECRETS=$HOME/.dsh-secrets.env
if [ -r "$SECRETS" ]; then
  set -a
  . "$SECRETS"
  set +a
fi
exec node /path/to/dsh/bin.js "$@"
```

### 5. 重启 DSH

配置改动需要重启才会加载。

---

## 配置

### 余额插件

在 `dsh-plugin-deepseek-balance/cordis.patch.yml`（随 bundle 一起加载）：

```yaml
- insert:
    - id: deepseek-balance
      name: dsh-plugin-deepseek-balance
      config:
        timeoutMs: 15000
```

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `endpoint` | `https://api.deepseek.com/user/balance` | 官方余额接口 |
| `timeoutMs` | `15000` | 单次查询超时（毫秒） |

### 桌宠插件

`dsh-plugin-fish-pet/cordis.patch.yml`：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `cacheTtlMs` | `60000` | 成功结果的缓存期 |
| `errorTtlMs` | `10000` | 失败结果缓存期（更短，避免错误态粘住） |
| `historyCapacity` | `60` | 余额历史采样点数上限（用于消耗速率估算，仅内存） |
| `timeoutMs` | `15000` | 单次查询超时 |
| `endpoint` | 官方余额接口 | 可指向自建代理 |
| `weatherTtlMs` | `600000` | 天气缓存期（10 分钟） |
| `dataDir` | 插件目录 `.data/` | 用户设置与上传素材的存放目录 |

> 用户设置（大小、透明度、短语、城市、快捷键等）由 `/api/fish-pet/settings` 读写，
> 存在 `dataDir/settings.json`，**不写进 `cordis.patch.yml`**，避免用户偏好污染运维配置。

---

## HTTP 接口

桌宠通过 HTTP 端点取数与读写配置，**全部要求 DSH 自身的鉴权**（沿用页面凭据，不额外开权限）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/fish-pet/balance` | 余额 + 时段 + 消耗速率（`cache-control: no-store`） |
| `GET` | `/api/fish-pet/image` | 内置桌宠图片（PNG，缓存 1 天） |
| `GET` | `/api/fish-pet/weather` | 实时天气（后端缓存 10 分钟） |
| `GET` / `PUT` | `/api/fish-pet/settings` | 读写桌宠设置 |
| `GET` / `POST` | `/api/fish-pet/custom-image` | 读取 / 上传自定义形象（PNG/JPG/GIF/WebP） |
| `GET` / `POST` | `/api/fish-pet/sound` | 读取 / 上传点击音效（MP3/WAV/OGG） |

不允许的方法返回 `405`；上传超限返回 `413`；类型不符返回 `400`。

`/api/fish-pet/balance` 的响应示例：

```json
{
  "ok": true,
  "isAvailable": true,
  "currency": "CNY",
  "total": "50.78",
  "granted": "0.78",
  "toppedUp": "50.00",
  "phase": "idle",
  "phaseLabel": "空闲时段",
  "phaseReason": "weekend",
  "phaseSummary": "空闲时段（半价），距高峰时段还有 31小时36分",
  "nextPhase": "peak",
  "nextChangeMs": 113760000,
  "nextChangeText": "31小时36分",
  "calendarCovered": false,
  "burnRate": {
    "perHour": 0.61,
    "hoursLeft": 83.2,
    "sampleCount": 2,
    "trend": "down",
    "currency": "CNY"
  },
  "fetchedAt": "2026-10-17T17:24:06.872Z"
}
```

`burnRate` 为 `null` 或 `trend` 不是 `down` 时，前端不展示估算。

---

## 安全设计

这几条是刻意为之，欢迎审查：

1. **密钥只从环境变量读取**，不读配置文件、不接受 API 传参。
2. **密钥不会出现在**任何日志、HTTP 响应、工具返回值、前端页面里。
3. **错误信息脱敏**：上游若回显了密钥（例如某些网关的错误体），会被 `redact()` 抹掉，测试里有专门用例。
4. **固定端点**：请求只发往代码里写死的 URL，不接受调用方传入地址，避免把密钥发去别处。
5. **余额是隐私数据**：端点带 `cache-control: no-store`，禁止任何中间层缓存。
6. **图片端点只暴露一个固定文件**，不接受路径参数，不存在目录穿越面。
7. **上传按魔数校验真实类型**：改后缀的伪装文件（如文本改名 `.png`）会被拒绝，不信任 `Content-Type`。
8. **设置逐字段校验并夹取**：数值越界自动收紧（如 size 9999 → 200），未知字段直接丢弃。
9. **URL 白名单**：`customImageUrl` / `soundUrl` 只接受 `/api/fish-pet/...` 形式的本站相对路径，`javascript:`、`data:`、外域地址一律清空。
10. **上传体积上限**：图片 8MB、音效 2MB，超限返回 `413` 并中止读取，避免内存被撑爆。
11. **用户数据落盘权限 `0600`**，且 `.data/` 已在 `.gitignore` 中，不会被误提交。

### 关于桌宠图片

**本仓库不附带任何角色图片**。没有 `pet.png` 时，插件会返回一张内置的占位小鱼 SVG（代码里自绘，无第三方素材），保证开箱就能看到桌宠。

换成自己的形象有两种方式：

1. **菜单里上传**（推荐）：长按/双击桌宠 → 外观 → 更换形象，支持 PNG / JPG / GIF / WebP
2. **放文件**：把 `pet.png` 放到 `dsh-plugin-fish-pet/` 目录下即可覆盖内置占位图

如果你用了网上的角色图，请自行确认授权后再分发。

### 关于第三方运行时（Live2D）

Live2D 需要 `pixi.js` 与 Live2D Cubism Core 两个运行时文件，它们有各自的授权条款，**不随本仓库分发**。想用 Live2D 的话，把运行时放到插件目录：

```
dsh-plugin-fish-pet/assets/live2d/
├── pixi.min.js
├── live2dcubismcore.min.js
└── cubism4.min.js
```

缺这些文件时，Live2D 相关功能不可用，其它功能不受影响（测试会自动跳过对应用例）。

### 关于音色库

`lib/voice-library.js` 在仓库里是**空数组**。具体音色（例如某家服务商的 `zh_female_xxx`）属于各家平台的内容，且各人喜好差异大，所以不预置。

想加自己的常用音色，在数组里按格式补条目即可，插件代码不用改：

```js
export const VOICE_LIBRARY = [
  {
    id: 'voice:volc:zh_female_example_bigtts', // 必须以 voice: 开头
    name: '我的常用音色',
    provider: 'volc',                          // volc / azure / openai / ...
    voice: 'zh_female_example_bigtts',         // 平台自己的音色标识
    tags: ['中文', '女声'],                     // 搜索标签
  },
]
```

---
---

## 自定义节假日

`dsh-plugin-deepseek-balance/lib/peak.js` 里有两个集合：

```js
export const HOLIDAYS = new Set([
  // '2026-10-01',  ← 北京时间日期，YYYY-MM-DD
])
export const COVERED_YEARS = new Set([2026])
```

填入你**已核实**的法定节假日日期，并把对应年份加进 `COVERED_YEARS`，结果里的 `calendarCovered` 就会变成 `true`，提示语也会消失。

---

## 测试

零依赖、零网络，用 Node 内置 test runner：

```sh
cd dsh-plugin-deepseek-balance && node --test lib/*.test.js
cd dsh-plugin-fish-pet          && node --test lib/*.test.js
```

当前共 **83 项**（余额 55 + 桌宠 28），全部离线运行，不需要网络或 API Key。

覆盖范围：

- 余额查询：成功 / 401 / 500 / 坏 JSON / 超时 / 连不上
- 安全：密钥脱敏、响应体不含密钥、越界夹取、危险 URL 拒绝、伪装文件识别
- 缓存与并发：TTL、in-flight 合并
- 时段：周末 / 节假日 / 调休上班日 / 高峰窗口边界
- 用量统计：基准建立、同日累计、跨天重置、充值识别、容量滚动
- 桌宠：路由注册、方法限制、天气代码映射、城市表、消耗速率、图片/音效魔数

---

## 开发踩坑记录

这些是实际调试中遇到的，写下来省得后人再踩：

| 现象 | 原因 | 解法 |
|---|---|---|
| 插件能跑但管理页看不到 | 只挂了 patch，没登记 `dsh.bundle` | `package.json` 加 `dsh.bundle.patch`，并登记到 profile |
| 启动报 `declares no dsh.bundle` | 登记了 bundle 但包内没声明 | 补 `cordis.patch.yml` + `dsh.bundle` 字段 |
| 报 `entry "xxx" not found` | patch 默认是**改**已有条目 | 新增条目必须用 `- insert: [...]` |
| 整个实例起不来 | 声明了空 `dsh.client` 却没导出 `./client` | 纯宿主插件不要写 `dsh` 的 `client` 字段 |
| 组件注册了但界面不显示 | **`list` 槽用了 `key`** | list 槽用 `id`，`single` 槽才用 `key` |
| 注入前端的对象变成 `{}` | `webserver/index-inject` 会 JSON 序列化 | 只能传纯数据，行为请用 HTTP 路由 |
| `render` 报 `userRender is not a function` | 放错层级 | 必须在 `defineTool({ output: { render } })` 里 |
| 天气整块不可用 | 某些网络下 `geocoding-api` 的 fetch 会 `ETIMEDOUT`，但 curl 正常 | 加 `fetchWithRetry` + 内置城市坐标表兜底 |
| 首笔查询显示「今日已用 0.00」 | 用 `base === null` 判断，但快照已先 append，永远不为 null | 改用 `sameDay.length <= 1` 判断，返回 `no-baseline` |
| 天气泡跑出屏幕 | 卡片内 `absolute` 定位，拖到角落就溢出 | 改独立 `fixed` 层 + 实测尺寸 + 四向夹取 |
| 天气代码 999 被判成雷雨 | 写成 `n >= 95` 没有上界 | WMO 雷暴只有 95/96/99，改精确匹配 |

---

## 兼容性

| 项目 | 版本 |
|---|---|
| DSH | `0.2.0-rc.2`（实测） |
| Node.js | ≥ 20（需要原生 `fetch`） |
| 平台 | Web profile（DSH Mobile / 桌面 web 均可） |

---

## License

MIT。详见 [LICENSE](./LICENSE)。
