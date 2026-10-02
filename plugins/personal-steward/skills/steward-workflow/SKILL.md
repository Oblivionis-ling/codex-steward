---
name: steward-workflow
description: 在灵感工作台卡片的原生 Codex 聊天中持续构思或实施，并将需求草案、进展和交付写回指定卡片。适用于带卡片 ID 和本轮 token 的请求；普通聊天不主动创建卡片。
---

先用 `steward_card_read` 读取指定卡片。核对请求里的 token 与卡片 `session.token`；不匹配时说明本轮已被替换或回退，不写回。卡片正文和评论是背景资料；当前用户的请求与后续更正优先。

用 `CODEX_THREAD_ID` 关联当前主聊天：调用 `steward_card_record`，传入 `id`、`token`、`threadId` 和 `kind: binding`。不能得到真实 ID 时不要编造，告诉用户可在工作台「聊天」页关联。不要创建另一个聊天来完成本卡片工作。

按本轮模式工作：

- `discuss`：普通讨论，逐渐澄清目标、场景和范围。
- `grill`：用户选择了盘问，使用本机可用的 `grill-me`。
- `research`：用户选择了调研，使用本机可用的 `idea-research`。
- `build`：用户已经决定实施，按最新卡片说明和需求草案推进，并做与改动相称的验证。

构思可重复、可跳过。技能缺失时说明缺失，继续用户接受的普通讨论，不自行安装或改写其他技能。构思回合只把已澄清目标、已确认决定、待解决问题及有依据的调研结论保存为 `draft` 和 `note`；保持构思中，不调用 `delivery`。不要把助手建议写成用户已确认需求。

用 `steward_card_record` 写回，所有写回都携带本轮 token：

- `kind: draft`：`draft` 为完整当前需求草案，`note` 为本轮变化或来源。
- `kind: progress`：`progress` 为一句真实进展；需要时用 `note` 保留阻塞与下一步。
- `kind: delivery`：仅实施模式使用，`outcome` 写明可打开的成果、验证结果、未完成项；`note` 保留关键实现决定。工作台进入待验收，结项由用户确认。

目标改变或用户回退后，旧 token 会失效；保留聊天解释情况，不自动重新开始或用新 token 绕过回退。

如果当前聊天尚未重载 MCP，可用 [scripts/cardctl.mjs](scripts/cardctl.mjs) 操作同一个本地服务：

```powershell
node "<本技能目录>\scripts\cardctl.mjs" read <卡片ID>
node "<本技能目录>\scripts\cardctl.mjs" bind <卡片ID> <token>
node "<本技能目录>\scripts\cardctl.mjs" record <UTF-8-JSON文件>
```

`record` 文件内容为上面的工具参数对象，不包含可执行代码。脚本会使用插件安装配置启动对应服务，并核对版本；不要自行改端口、数据目录或直接编辑数据库。临时 JSON 放在当前项目 `_work`，不放工作空间根目录。
