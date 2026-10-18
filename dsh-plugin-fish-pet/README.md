# dsh-plugin-fish-pet

悬浮在 DSH 界面上的桌宠：显示 DeepSeek 余额、峰谷时段、天气，可以摸摸、换装、说语音，
支持 **上游透明动画**、**动态形象（伪 Live2D）** 与 **真正的 Live2D 模型**。

> 本 README 只描述桌宠插件。Live2D 运行时来自第三方，许可注意事项见
> [`assets/live2d/licenses/NOTICE.md`](./assets/live2d/licenses/NOTICE.md)。

## 动画形象（上游 dsh-pet 素材，v0.5.0 新增）

和桌面视频里一样的「蓝色大肥鱼」：待机呼吸、随机小动作、点击回应、拖拽拎起，
106 个 640×360 的透明 webm（VP9-alpha），动作池与权重直接沿用上游
[`PC2005-cloud/dsh-pet`](https://github.com/PC2005-cloud/dsh-pet)（MIT）：

- 待机：循环「待机呼吸休闲」
- 随机：按上游分类权重抽（小动作 20 / 玩耍 20 / 吃什么 16 / 时节 14 / 文字 10），播完回待机
- 点击：随机播「点击回应-*」
- 拖拽：播放「被鼠标拖拽悬空反馈」，松手回待机
- 两个开关：「随机小动作」「点击回应」都可以单独关掉

**素材不入库**（共 53MB，且只在本机自用）。把上游 `dsh-pet/assets/webm/*.webm`
放进插件的 `.data/animations/webm/` 即可；也可以用 `animationDir` 配置项或
环境变量 `DSH_FISH_PET_ANIM_DIR` 指向别的目录：

```sh
mkdir -p plugins/dsh-plugin-fish-pet/.data/animations/webm
cp dsh-pet/assets/webm/*.webm plugins/dsh-plugin-fish-pet/.data/animations/webm/
```

放好后刷新页面，长按桌宠打开菜单 →「动画形象（上游素材）」→ 打开「使用动画形象」。
菜单里会显示「已找到 N/106 个动画」；一份都没找到时会自动回退图片形象，并提示素材目录。

### 手机 / Android WebView 的透明背景

桌面 Chrome、Electron 能直接播放 VP9 的 alpha 通道；但 Android 的 MediaCodec / ExoPlayer
会把透明背景丢成**黑底**。插件做了一个兜底：

1. 播放前先探测一次 `<video>` 的 alpha（把一帧画到 canvas 读左上角像素）；
2. 不支持 alpha 时，自动改用**白底版本 + `mix-blend-mode: multiply`**——白底被正片叠底
   「抠掉」，在浅色界面上和透明版观感几乎一致；
3. 白底版本也缺失时回退图片形象，不会留下一个黑方块。

白底版本可以一键生成（需要本机有 ffmpeg）：

```sh
mkdir -p plugins/dsh-plugin-fish-pet/.data/animations/webm-matte
for f in plugins/dsh-plugin-fish-pet/.data/animations/webm/*.webm; do
  ffmpeg -y -c:v libvpx-vp9 -i "$f" \
    -filter_complex "color=white:s=640x360[bg];[bg][0:v]overlay=shortest=1:format=auto" \
    -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -threads 4 \
    -b:v 0 -crf 30 -pix_fmt yuv420p \
    "plugins/dsh-plugin-fish-pet/.data/animations/webm-matte/$(basename "$f")"
done
```

> 正片叠底依赖浅色背景：DSH 深色主题下人物会偏暗，此时建议用 Live2D 或图片形象。

开启方式：长按桌宠打开菜单 →「动画形象（上游素材）」→ 打开「使用动画形象」。

大小与其他形象共用「大小 / 缩放」滑杆：可见人物高度 ≈ `size`（默认 76 = 76px 高）。

卡片和点击热区只包**人物本体的包围盒**（640×360 画布里的 `196,60,240,270`，来自上游桌面版
manifest 的 body_box），不含 16:9 画布四周的透明留白——所以桌宠可以真正拖到贴边，
透明区域也不会挡住下面界面的点击。烟花、落叶这类大特效会超出人物框照常显示，只是不算进点击区。

## 动态形象（伪 Live2D）

不用任何模型文件，就能把**当前形象**（内置图或你上传的图片/GIF）变成会动的桌宠：

- 呼吸起伏、整体轻微摆动，越靠上（头发/头部）摆幅越大
- 视线/身体跟随指针做小幅视差
- 摸摸时有一次短促的弹性抖动
- 可在菜单里调「动态幅度」（0%～150%）

实现方式是把图片横向切成 56 条、用多相位正弦做整体网格变形，因此**只能整体变形**，
不能像真正的 Live2D 那样分别驱动眼睛、嘴巴、手脚。想要眨眼/口型/多套动作，
请使用下面的 Live2D 模型入口。

开启方式：长按桌宠打开菜单 →「动态形象（伪 Live2D）」→ 打开「让当前形象动起来」。

## Live2D 模型（v0.3.0 新增）

### 快速上手

1. 把模型文件夹打包成一个 **zip**（手机上的文件管理器一般都有「压缩」功能）。
2. 长按桌宠（或双击 / `Ctrl+Shift+P`）打开菜单，找到「Live2D 模型」一栏。
3. 点「上传模型压缩包」，选择 zip。
4. 上传成功后会自动切换到 Live2D 并选中新模型；也可以在模型列表里随时切换、删除。
5. 用「模型缩放」「水平偏移 / 垂直偏移」微调位置；「待机与点击动作」「视线跟随指针」可单独关掉。

模型缩略信息（Cubism 版本、体积、动作组数量）会显示在列表里。删除当前正在使用的模型时，
外观会自动回退到图片模式，不会出现空白画布。

### 模型要求

- **只支持 Cubism 3 / 4**（`*.model3.json` + `*.moc3` + 贴图）。
  Cubism 2（`*.model.json` + `*.moc`）会被明确拒绝并提示原因。
- zip 内任意层级都可以，插件会自动找到第一个（层级最浅的）`model3.json`，
  并校验它引用的 moc3、贴图是否齐全。
- 压缩包 ≤ **48 MB**，解压后 ≤ **96 MB**，文件数 ≤ 3000；
  不支持加密 zip、分卷 zip、ZIP64。带密码的包会提示去掉密码后重新压缩。
- 常见模型包自带的 `__MACOSX/`、`.DS_Store` 等垃圾文件会被自动忽略。
- 模型默认适配到方形画布内，可在菜单里放大到 250%。

### 行为与降级

- 只有浏览器支持 **WebGL** 时才会渲染 Live2D；不支持时自动回退图片，并在桌宠下方提示「无 WebGL」。
- 模型加载失败（文件缺失、格式不对、运行时脚本加载失败）会回退到图片形象，
  并在菜单/桌宠下方提示 `Live2D 失败`；更换模型后会重新尝试。
- 渲染上限 30fps，页面隐藏时随桌宠一起暂停，尽量省电。
- 摸摸桌宠会随机播放 `TapHead` / `TapBody` / `Tap` 等动作组，并有一定概率切换表情；
  没有这些动作组时回退到任意非 Idle 动作组。
- 拖动、长按、双指缩放等手势仍由外层卡片处理，Live2D canvas 不接收指针事件，不会抢手势。

## 安装

插件通过 DSH profile 的 `dependencies` 以 `link:` 方式加载：

```json
{
  "dependencies": {
    "dsh-plugin-fish-pet": "link:/absolute/path/to/dsh-plugin-fish-pet"
  }
}
```

在 profile 的 `dsh.profile.bundles` 里加入 `dsh-plugin-fish-pet`，然后重启 DSH 实例。
配置项见 `cordis.patch.yml`（`cacheTtlMs` 等余额缓存参数）。

## 数据位置

用户设置、自定义图片、音效、Live2D 模型和动画素材都写在插件目录的 `.data/`（已加入 `.gitignore`）：

```
.data/
  settings.json          # 用户设置（权限 0600）
  custom-image           # 自定义外观
  sound                  # 自定义点击音效
  voices.json            # 语音声源
  live2d/<id>/meta.json  # Live2D 模型元数据
  live2d/<id>/model/...  # 模型原始文件（包含 moc3 / 贴图 / 动作）
  animations/webm/*.webm # 上游 dsh-pet 的透明动画（53MB，只在本机使用，不进仓库）
  animations/webm-matte/*.webm # 白底回退版（Android WebView 不支持 alpha 时用）
```

模型 id 由内容哈希生成（`l2d-` + 12 位十六进制），同一份模型重复上传是幂等覆盖。

## HTTP 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/fish-pet/balance` | 余额 + 峰谷时段 + 消耗速率 |
| GET | `/api/fish-pet/image` | 内置桌宠图 |
| GET | `/api/fish-pet/weather` | 实时天气（Open-Meteo） |
| GET/PUT | `/api/fish-pet/settings` | 读写用户设置（逐字段校验） |
| GET/POST/DELETE | `/api/fish-pet/custom-image` | 自定义外观 |
| GET/POST/DELETE | `/api/fish-pet/sound` | 点击音效 |
| GET/POST/DELETE | `/api/fish-pet/live2d/models` | Live2D 模型列表、上传 zip、删除 |
| GET | `/api/fish-pet/live2d/model/<id>/<path>` | 模型静态文件（路径式，保证相对引用可解析） |
| GET | `/api/fish-pet/live2d/runtime/<name>` | 内置运行时脚本（白名单） |
| GET | `/api/fish-pet/animations` | 动画素材清单（扫描 `.data/animations/webm`，按上游池子过滤） |
| GET | `/api/fish-pet/animation/<name>.webm` | 单个透明动画文件（名字必须是清单里的条目） |
| GET | `/api/fish-pet/voices` 等 | 语音声源与 TTS（详见 `index.js` 顶部注释） |


## 每日声源校准（v0.4.0 新增）

每天固定时间在后台搜一轮「大肥鱼」相关音频，用**说话人相似度**把和基准音色不一致的
片段挡掉，只把达标、且能识别出文字的片段加成**独立**声源。基准音色与当前声源永远只读。

### 它怎么跑

1. 每天 `harvestAt`（默认 10:00）之后第一次有机会时启动，单次预算默认 20 分钟。
   DSH 没运行时不会跑；下次打开会在到点后补跑（当天跑过就不再跑）。
2. 按 `harvestKeywords` 搜 B 站，去重后逐个下载音频（只下音频流，不碰视频）。
3. 用 Silero VAD 切出 4–20 秒的人声段；CAM++ 说话人嵌入和基准算余弦相似度，
   低于 `harvestMinSim`（默认 0.65）直接丢弃；再用 SenseVoice 识别参考文本。
4. 达标片段按相似度排序，自动加成 `auto-*` 声源（名字带日期和相似度），
   **不会切换当前声源**，也**不会改基准**；自动声源最多保留 8 条，旧的自动清理。
5. 跑完在桌宠左侧弹一条通知，通知上就带「关闭肥鱼」按钮。

### 基准音色（anchor）

- 默认用**当前声源**（本地克隆声源的参考音频）当基准。
- 也可以在菜单「每日声源校准 → 基准音色」里粘 BV 号 / B 站链接，
  插件会下载该视频、VAD 切段、取「自洽度最高且时长接近 10 秒」的一段当基准
  （`scripts/voice_harvest.py anchor`）。换基准不会动任何已有声源。

### 一键关闭肥鱼

- 通知条上的「关闭肥鱼」、设置页开关、菜单都会把总开关同步给宿主（`POST /api/fish-pet/power`）。
- 关闭后：桌宠隐藏、语音停止、每日校准暂停；右下角留一个半透明小圆点，点一下恢复。

### 依赖的模型

除了克隆用的 ZipVoice + vocos，还需要两个小模型（放在同一个模型目录，
默认 `~/.dsh/fish-pet/models`）：

| 文件 | 用途 | 来源 |
|---|---|---|
| `3dspeaker_campplus.onnx` | 说话人相似度（防污染） | sherpa-onnx `speaker-recongition-models` release |
| `silero_vad.onnx` | 人声切段 | sherpa-onnx `asr-models` release |

`python3 scripts/voice_harvest.py probe --model-dir <模型目录>` 可以自检依赖是否齐。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/fish-pet/harvest` | 运行状态、上次报告、待确认通知、当前基准 |
| POST | `/api/fish-pet/harvest` | `{action:"run"}` 立即跑；`{action:"ack"}` 清通知；`{action:"anchor",input:"BV..."}` 换基准 |
| GET | `/api/fish-pet/harvest/audio?run=<runId>&f=<name>.wav` | 候选片段试听 |
| GET/POST | `/api/fish-pet/power` | 总开关（一键关闭肥鱼），`{enabled:false}` 同时暂停后台校准 |

### 说明与边界

- **这是零样本声源校准，不是模型微调**：ZipVoice 在手机上只做零样本克隆，
  插件的「校准」= 用相似度筛出更干净的参考音频，不会重新训练模型。
- 只处理 B 站公开视频的音频流；不登录、不碰账号数据，请求之间有间隔。
- 相似度是「同一个人/同一音色」的相对判断，跨「唱歌 ↔ 说话」这种域会明显偏低，
  所以基准最好和要搜的素材同域（都用唱歌，或都用说话）。
- 校准在 DSH 进程内跑，App 被杀掉就会中断，不会在后台偷偷跑。

## 安全约定

- 上传的 zip 一律当作不可信输入：条目名拒绝绝对路径、`..`、盘符、控制字符；
  解压体积/数量设上限，防 zip 炸弹；落盘前先写临时目录再原子替换。
- 模型文件路由会把 id 限制成 `l2d-*` 形状，并对相对路径做二次前缀校验，杜绝目录穿越。
- 设置逐字段校验并夹取，未知字段丢弃；URL 字段只允许本站相对路径。
- API Key 只从环境变量读取，绝不出现在响应体和日志里。

## 开发与测试

```sh
cd plugins/dsh-plugin-fish-pet
node --test lib/pet.test.js lib/live2d.test.js lib/voice.test.js lib/harvest.test.js \
  lib/client-scope.test.js lib/anim-catalog.test.js lib/anim-client.test.js
node --check index.js && node --check client.js
```

`lib/live2d-package.js` 只做「zip → 文件列表 + 元数据」的纯逻辑，不碰文件系统，
因此可以离线单测；路由与落盘逻辑在 `index.js`。
客户端是直接分发的 UMD 风格 bundle（`window.__ModuleLoader__.load(...)`），
没有构建步骤，改完 `client.js` 后由 DSH 的客户端 HMR 或刷新页面生效。

## 许可

插件代码 MIT。随包分发的 Live2D 运行时包含第三方组件，其中
**Live2D Cubism Core 为专有软件**，请先阅读
[`assets/live2d/licenses/NOTICE.md`](./assets/live2d/licenses/NOTICE.md) 再决定是否对外分发。
