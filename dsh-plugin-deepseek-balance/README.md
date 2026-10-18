# dsh-plugin-deepseek-balance

DeepSeek Harness 插件：一个宿主工具 `deepseek_balance`，一次返回**账户余额**、**今日已用金额**、**当前处于高峰还是空闲时段**（含距切换倒计时）。

API Key 只从环境变量读取，不落盘、不回显。

## 它回答什么

```
余额充足：50.27 CNY（赠送 0.27，充值 50.00）
今日已用：0.69 CNY

时段：空闲时段（半价，周末），距高峰时段还有 30小时36分
```

- **余额**：总余额、赠送余额、充值余额。
- **今日已用**：基于插件自己记录的快照计算（见下文「今日已用是怎么算的」）。
- **峰谷时段**：按 DeepSeek 官方规则判定，并说明判定依据（法定节假日 / 周末 / 调休上班日 / 工作日高峰 / 工作日非高峰）。

## 规则来源

| 数据 | 来源 |
| --- | --- |
| 峰谷时段与价格 | [DeepSeek API 文档 · 模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) |
| 2026 年法定节假日与调休 | [国务院办公厅关于 2026 年部分节假日安排的通知](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)（国办发明电〔2025〕7号） |

**高峰时段**：北京时间，周一至周五（不含中国法定节假日）`9:00-12:00`、`14:00-18:00`。
**空闲时段**：其余全部时间，价格为高峰的 50%。

判定的优先级是：法定节假日 → 调休上班日 → 周末 → 普通工作日。调休上班的周末按工作日走钟点，所以 `2026-10-10`（周六）上午 **是** 高峰。

## 今日已用是怎么算的

DeepSeek 余额接口只给当前余额，**不提供历史消耗**。因此：

1. 每次调用工具时，把当前余额连同北京时间日期记进一个快照文件；
2. 取当天**第一笔**快照作为基准，`今日已用 = 基准余额 − 当前余额`；
3. 北京时间零点自然换基准；
4. 如果余额比基准高（说明期间充值过），不报负数，而是明确显示「期间发生过充值，无法计算」。

**局限**：只有调用过工具的那些时刻才有快照。如果今天第一次调用发生在中午，那么只会统计从中午开始的消耗，**之前的消耗无法追溯**。这是余额接口的固有限制，不是实现缺陷。

快照文件默认在 `~/.dsh/deepseek-balance/usage.json`，只保留最近 30 天左右。

## 安装

### 通过插件管理器（推荐）

在插件管理里指向本目录，或作为 bundle 安装：

```bash
dsh plugin --profile <profile> add <本目录绝对路径>
```

### 手动

包已声明 `dsh.bundle.patch`，可加入 profile 的 `dsh.profile.bundles`。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `endpoint` | `https://api.deepseek.com/user/balance` | 余额接口地址 |
| `timeoutMs` | `15000` | 请求超时（毫秒） |
| `usageFile` | `~/.dsh/deepseek-balance/usage.json` | 快照文件路径；设为空字符串可关闭今日消耗追踪 |

## 环境变量

按顺序读取，命中即用：

1. `DEEPSEEK_API_KEY`
2. `DSH_DEEPSEEK_API_KEY`

## 节假日日历的覆盖范围

目前**只收录 2026 年**。超出范围的年份，判定会退回「按工作日/周末估算」，并在输出里明确标注，不会假装准确。

要新增年份，编辑 `lib/peak.js` 里的 `HOLIDAYS`、`WORKDAY_OVERRIDES` 与 `COVERED_YEARS`，来源请使用国务院办公厅的正式通知。

## 开发与测试

```bash
npm test
```

或逐个运行：

```bash
node --test lib/peak.test.js
node --test lib/usage.test.js
node --test lib/usage-store.test.js
node --test lib/balance.test.js
```

测试全部离线：不联网、不需要真实 API Key、不依赖 DSH 运行时。

## 结构

```
lib/
├── index.js          宿主插件：注册 deepseek_balance 工具
├── balance.js        余额查询与响应规范化（纯逻辑）
├── peak.js           峰谷时段判定与节假日日历（纯逻辑）
├── usage.js          今日消耗的快照与算术（纯逻辑）
├── usage-store.js    快照文件读写（容忍各类失败）
└── *.test.js         离线测试
```

## 安全约定

- API Key 只从环境变量读取，绝不写入返回值、日志或错误信息；
- 任何异常路径的错误信息都过一遍 `redact()`，防止上游错误原文带回 Key；
- 只向固定端点发 GET，不接受调用方传入任意 URL。

## License

MIT
