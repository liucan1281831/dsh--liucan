# DeepSeek Balance Suite for DSH

> 本人写的 DSH 插件，欢迎大佬们多多指正。

为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 写的两个插件：

| 插件 | 作用 |
|---|---|
| **dsh-plugin-deepseek-balance** | 提供一个 Agent 工具 `deepseek_balance`，查询 DeepSeek 账户余额，并附带**峰谷计价时段**判定 |
| **dsh-plugin-fish-pet** | 在界面右上角放一个桌宠，实时显示余额与计价时段，可在设置里开关 |

两个插件共享同一套余额查询与时段逻辑，**信息永远一致**。

---

## 功能

### 余额工具 `deepseek_balance`

Agent 可以直接调用，返回结构化数据：

```
余额充足：53.69 CNY（赠送 3.69，充值 50.00）

时段：空闲时段（半价），距高峰时段还有 31小时36分；本年度节假日日历未覆盖，仅按工作日/周末估算
```

返回字段：

| 字段 | 说明 |
|---|---|
| `ok` | 查询是否成功 |
| `summary` | 一行人类可读摘要（含时段） |
| `isAvailable` | 余额是否足以继续调用 |
| `balances[]` | 按币种的总余额 / 赠送余额 / 充值余额 |
| `phase` | `peak` 或 `idle` |
| `phaseReason` | `weekend` / `holiday` / `peak-window` / `off-window` |
| `calendarCovered` | 该年份的节假日日历是否已收录 |
| `checkedAt` | 查询时间（ISO 8601） |

### 桌宠

- 悬浮在界面**右上角**，可拖动，位置记忆
- 显示余额数字与**峰谷时段徽标**（空闲绿 / 高峰橙）
- 点击刷新（带缓存），自动轮询（60s，页面隐藏时暂停）
- 右上角 `×` 收起为一个小把手
- **设置 → 通用** 里有「余额桌宠」开关，改完立即生效

### 消耗速率估算 🆕

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

> ⚠️ **节假日日历当前为空。** 代码不硬编码任何未经核实的放假日期，因此节假日会被按工作日估算，并在结果里以 `calendarCovered: false` 明确标注。要补全请见下方「自定义节假日」。

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

---

## HTTP 接口

桌宠通过两个只读端点取数，**都要求 DSH 自身的鉴权**（沿用页面凭据，不额外开权限）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/fish-pet/balance` | 余额 + 时段 + 消耗速率（`cache-control: no-store`） |
| `GET` | `/api/fish-pet/image` | 桌宠图片（PNG，缓存 1 天） |

非 `GET` 请求返回 `405`。

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

### 关于桌宠图片

仓库里的 `pet.png` 是使用者提供的角色图。**如果你要公开发布，请确认你拥有该图片的使用权**，或替换成自己的图。替换方法：把 `dsh-plugin-fish-pet/pet.png` 换成同名 PNG 即可，建议透明背景、竖向比例。

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
cd dsh-plugin-deepseek-balance && node --test lib/balance.test.js lib/peak.test.js
cd dsh-plugin-fish-pet          && node --test lib/pet.test.js
```

覆盖：成功/401/500/坏 JSON/超时/连不上、密钥脱敏、缓存 TTL、并发合并、方法限制、时段边界、消耗速率估算（下降/上涨/持平/采样不足/容量滚动）。

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
