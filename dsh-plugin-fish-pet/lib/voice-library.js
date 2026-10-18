/**
 * 社区音色库（可选内容，发行版默认为空）。
 *
 * 这里只放「具体音色」条目，例如某家服务的 zh_female_xxx。
 * 音色列表属于各服务商，且各人偏好不同，因此不随仓库分发；
 * 需要时按下面的结构自行补充即可，插件不需要改动。
 *
 *   {
 *     id: 'voice:volc:zh_female_xxx',  // 必须以 voice: 开头
 *     name: '我的音色',                 // 显示名
 *     provider: 'volc',                 // volc / azure / openai / ...
 *     voice: 'zh_female_xxx',           // 服务商自己的音色标识
 *     tags: ['中文', '女声'],            // 搜索标签
 *   }
 */
export const VOICE_LIBRARY = []
